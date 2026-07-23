import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateOffersForCart } from "./evaluateOffersForCart";
import { getContestableAvailableForVariants } from "@/lib/inventory/getContestableAvailable";
import type { AppliedRule, CartLineForEval } from "@/types/offers";
import type { FeeBreakdownEntry } from "@/types/fee";

/**
 * Phase 4 helper: read applied codes from the checkout session, evaluate
 * offers (or honor a snapshot if one was captured at intent), apply any
 * fee waivers to the fees_breakdown, and return the bundled result for
 * placeOrder to consume.
 *
 * Two-mode operation:
 *
 *   1. **Fresh evaluation** (no session, or snapshot expired/invalid):
 *      Call evaluateOffersForCart with the current cart state. Result is
 *      authoritative for this order; the engine reads the latest active
 *      offers + effective stock.
 *
 *   2. **Snapshot honored**: When a session has `offer_snapshot` set
 *      AND it's still within TTL AND the cart subtotal hasn't drifted
 *      significantly, use the snapshot verbatim. This protects the
 *      customer from offer expiry / stock-state changes between
 *      checkout intent and order commit (decision #16).
 *
 * Fee waivers: when the engine emits a `fee_waiver` AppliedRule, the
 * matching row in fees_breakdown gets its `charged` zeroed. `api_quote`
 * stays for accounting (the store still pays the carrier; only the
 * customer is waived per decision #8).
 */

interface ApplyInput {
  admin: SupabaseClient;
  checkoutSessionId: string | null;
  customerId: string;
  isAuthenticated: boolean;
  lines: CartLineForEval[];
  subtotal: number;
  itemCount: number;
  feesBreakdown: FeeBreakdownEntry[];
}

interface ApplyResult {
  discountAmount: number;
  adjustedFeesBreakdown: FeeBreakdownEntry[];
  adjustedFeesTotal: number;
  applied: AppliedRule[];
  /** Offers actually applied — for the order_rule_applications insert. */
  warnings: Array<{ rule_id: string; kind: string; message: string }>;
}

const SNAPSHOT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours per the plan §5.7.2
const SNAPSHOT_SUBTOTAL_DRIFT_TOLERANCE = 0.01;

interface OfferSnapshot {
  applied: AppliedRule[];
  total_discount: number;
  total_fee_waiver: { shipping: number; cod: number };
  subtotal_at_lock: number;
  evaluated_at: string;
  code_set: string[];
}

export async function applyOffersAtPlaceOrder(input: ApplyInput): Promise<ApplyResult> {
  let applied: AppliedRule[] = [];
  let totalDiscount = 0;
  let totalFeeWaiver = { shipping: 0, cod: 0 };

  // ─── Path A — honor snapshot if present + valid ────────────────────
  let usedSnapshot = false;
  if (input.checkoutSessionId) {
    const { data: sessionRow } = await input.admin
      .from("cart_checkout_sessions")
      .select("offer_snapshot, snapshot_taken_at")
      .eq("id", input.checkoutSessionId)
      .maybeSingle();
    const session = sessionRow as
      | {
          offer_snapshot: OfferSnapshot | null;
          snapshot_taken_at: string | null;
        }
      | null;

    if (session?.offer_snapshot && session.snapshot_taken_at) {
      const ageMs = Date.now() - new Date(session.snapshot_taken_at).getTime();
      const subtotalDrift = Math.abs(
        input.subtotal - session.offer_snapshot.subtotal_at_lock
      );
      if (
        ageMs < SNAPSHOT_TTL_MS &&
        subtotalDrift < SNAPSHOT_SUBTOTAL_DRIFT_TOLERANCE
      ) {
        applied = session.offer_snapshot.applied;
        totalDiscount = session.offer_snapshot.total_discount;
        totalFeeWaiver = session.offer_snapshot.total_fee_waiver;
        usedSnapshot = true;
      }
    }
  }

  // ─── Path B — fresh evaluation ─────────────────────────────────────
  if (!usedSnapshot) {
    // Pull the applied codes from the session (if any).
    let codes: string[] = [];
    if (input.checkoutSessionId) {
      const { data: sessionCodes } = await input.admin
        .from("cart_checkout_sessions")
        .select("applied_codes")
        .eq("id", input.checkoutSessionId)
        .maybeSingle();
      const sessionRow = sessionCodes as { applied_codes: string[] } | null;
      codes = Array.isArray(sessionRow?.applied_codes)
        ? (sessionRow.applied_codes as string[])
        : [];
    }

    const variantIds = Array.from(new Set(input.lines.map((l) => l.variant_id)));
    const inventoryByVariant =
      variantIds.length > 0
        ? await getContestableAvailableForVariants(variantIds)
        : new Map<string, number>();

    const evalResult = await evaluateOffersForCart({
      lines: input.lines,
      subtotal: input.subtotal,
      itemCount: input.itemCount,
      customerId: input.customerId,
      isAuthenticated: input.isAuthenticated,
      codes,
      evaluationTime: new Date(),
      currency: "EUR",
      inventoryByVariant,
    });

    applied = evalResult.applied;
    totalDiscount = evalResult.total_discount;
    totalFeeWaiver = evalResult.total_fee_waiver;
  }

  // ─── Apply fee waivers to fees_breakdown ───────────────────────────
  // The engine emits flags (0 = not waived; 1 = waive). Translate to:
  //   for each fees_breakdown entry whose category_slug matches the
  //   waiver kind, save the `charged` amount under `waived_amount`
  //   then set `charged = 0`. api_quote stays for accounting.
  const adjustedFeesBreakdown: FeeBreakdownEntry[] = input.feesBreakdown.map(
    (entry) => {
      if (
        (totalFeeWaiver.shipping > 0 && entry.category_slug === "shipping") ||
        (totalFeeWaiver.cod > 0 && entry.category_slug === "cod")
      ) {
        return {
          ...entry,
          meta: { ...(entry.meta ?? {}), waived_amount: entry.charged },
          charged: 0,
        };
      }
      return entry;
    }
  );
  const adjustedFeesTotal = round2(
    adjustedFeesBreakdown.reduce((s, e) => s + Number(e.charged ?? 0), 0)
  );

  return {
    discountAmount: round2(totalDiscount),
    adjustedFeesBreakdown,
    adjustedFeesTotal,
    applied,
    warnings: [],
  };
}

/**
 * Inserts one row per AppliedRule into order_rule_applications. Run
 * AFTER the order has committed successfully — the audit table has
 * FK to orders.id with ON DELETE CASCADE so it would survive a rollback
 * anyway, but we run post-commit to keep the order insert path lean.
 */
export async function recordOfferApplications(
  admin: SupabaseClient,
  orderId: string,
  applied: AppliedRule[],
  currency: string
): Promise<void> {
  if (applied.length === 0) return;

  const rows = applied.map((a) => ({
    order_id: orderId,
    offer_id: a.offer_id,
    rule_id: a.rule_id,
    code_id: a.code_id,
    affiliate_id: a.affiliate_id,
    amount_off: a.amount_off,
    currency,
    line_allocations: a.line_allocations,
  }));

  const { error } = await admin.from("order_rule_applications").insert(rows);
  if (error) {
    console.error("[offers] order_rule_applications insert failed:", error.message);
    return;
  }

  // Atomic counter bump for the applied codes (v2.2). Auto-apply rules
  // without codes have no usage-tracking concept — skipped here.
  const codeIds = Array.from(
    new Set(
      applied
        .map((a) => a.code_id)
        .filter((x): x is string => x !== null)
    )
  );
  if (codeIds.length > 0) {
    const { error: rpcErr } = await admin.rpc("record_code_usage", {
      p_code_ids: codeIds,
      p_customer_id: null,
    });
    if (rpcErr) {
      console.error("[offers] record_code_usage failed:", rpcErr.message);
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
