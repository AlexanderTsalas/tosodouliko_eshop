"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  holdSoftAllOrFail,
  releaseSoftAll,
} from "@/lib/inventory/holdSoftAllOrFail";
import { getEffectiveAvailableForVariants } from "@/lib/inventory/getEffectiveAvailable";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { ReservationLine } from "@/lib/inventory/reserveAllOrFail";

const SOFT_SESSION_TTL_MIN = 15;

export interface ContestedLine {
  product_id: string;
  variant_id: string;
  product_name: string;
  variant_label: string | null;
  requested_quantity: number;
  available_now: number;
}

export type StartCheckoutSessionResult =
  | {
      kind: "ok";
      /** id of the cart_checkout_sessions row, used to validate the eventual placeOrder call. */
      session_id: string;
      /**
       * Contention-driven expiry. NULL when nobody is waiting behind this
       * session — the holder can take as long as they need. Set to a deadline
       * (~15 min) only after a `soft_waits` row appears.
       */
      expires_at: string | null;
    }
  | {
      kind: "contention";
      /** Items that couldn't be soft-held because they're contested. */
      contested: ContestedLine[];
    };

/**
 * Engages Phase 2 (soft contention) for the customer's cart. Called when the
 * customer clicks "Ολοκλήρωση παραγγελίας" in the cart, BEFORE navigating to
 * the checkout page.
 *
 * Returns one of:
 *  - { kind: "ok", session_id, expires_at }    on success
 *  - { kind: "contention", contested[] }       when one or more items can't be
 *    soft-held because another customer is checking out with the inventory.
 *    The Phase 3 contention modal renders from this payload.
 *
 * Wrapped in a Result for actual error conditions (auth/cart missing/etc.).
 */
export async function startCheckoutSession(): Promise<
  Result<StartCheckoutSessionResult>
> {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<StartCheckoutSessionResult>(
      "Συνδεθείτε για να ολοκληρώσετε την παραγγελία.",
      "UNAUTHENTICATED"
    );
  }
  const userId = authData.user.id;
  const admin = createAdminClient();

  // Customer + cart are independent reads — fetch in parallel.
  const [{ data: custRow }, { data: cartRow }] = await Promise.all([
    admin
      .from("customers")
      .select("id")
      .eq("auth_user_id", userId)
      .maybeSingle(),
    admin
      .from("carts")
      .select("id, status")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle(),
  ]);
  const customerId = (custRow as { id: string } | null)?.id ?? null;
  if (!customerId) {
    return fail<StartCheckoutSessionResult>(
      "Λείπει το προφίλ πελάτη.",
      "NO_CUSTOMER"
    );
  }
  const cart = cartRow as { id: string; status: string } | null;
  if (!cart) {
    return fail<StartCheckoutSessionResult>(
      "Το καλάθι σας είναι άδειο.",
      "EMPTY_CART"
    );
  }

  // Cart items + existing session check are independent — both need
  // cart.id + customerId which we already have. Fetch in parallel.
  const nowIso = new Date().toISOString();
  const [{ data: itemRows }, { data: existingRow }] = await Promise.all([
    admin
      .from("cart_items")
      .select(
        "variant_id, quantity, product_id, products(name), product_variants(attribute_combo)"
      )
      .eq("cart_id", cart.id),
    admin
      .from("cart_checkout_sessions")
      .select("id, expires_at")
      .eq("customer_id", customerId)
      .eq("cart_id", cart.id)
      .eq("state", "soft")
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  type CartItemRow = {
    variant_id: string | null;
    quantity: number;
    product_id: string;
    products: { name: string } | { name: string }[] | null;
    product_variants:
      | { attribute_combo: Record<string, string> | null }
      | { attribute_combo: Record<string, string> | null }[]
      | null;
  };
  const cartItems = ((itemRows ?? []) as CartItemRow[]).filter(
    (r): r is CartItemRow & { variant_id: string } =>
      Boolean(r.variant_id) && r.quantity > 0
  );
  if (cartItems.length === 0) {
    return fail<StartCheckoutSessionResult>(
      "Το καλάθι σας είναι άδειο.",
      "EMPTY_CART"
    );
  }
  if (existingRow) {
    const existing = existingRow as { id: string; expires_at: string | null };
    return ok({
      kind: "ok",
      session_id: existing.id,
      expires_at: existing.expires_at,
    });
  }

  const lines: ReservationLine[] = cartItems.map((c) => ({
    variant_id: c.variant_id,
    quantity: c.quantity,
  }));

  // Phase 4A: batch-consume any active priority_holds into soft_held. The
  // RPC replaces the per-item loop (N×3 queries → 1 call). Returns the
  // variant_ids that were successfully consumed; the rest fall through to
  // regular hold_soft.
  const { data: consumedRaw } = await admin.rpc(
    "consume_priority_holds_for_checkout" as never,
    {
      p_customer_id: customerId,
      p_variant_ids: lines.map((l) => l.variant_id),
      p_quantities: lines.map((l) => l.quantity),
    } as never
  );
  const consumedPriorityVariantIds = new Set<string>(
    (consumedRaw as string[] | null) ?? []
  );
  const consumedPriorityRollback: ReservationLine[] = lines.filter((l) =>
    consumedPriorityVariantIds.has(l.variant_id)
  );

  const linesNeedingHold = lines.filter(
    (l) => !consumedPriorityVariantIds.has(l.variant_id)
  );

  const holdResult = await holdSoftAllOrFail(linesNeedingHold);
  if (!holdResult.success) {
    // Rollback: release the soft holds we converted from priority. The
    // priority hold itself is forfeited (consumed_at already set).
    if (consumedPriorityRollback.length > 0) {
      await releaseSoftAll(consumedPriorityRollback);
    }
    if (holdResult.code === "INSUFFICIENT_INVENTORY") {
      // Identify which items are contested by checking effective_available
      // for each cart line. We do this as a follow-up rather than pre-checking
      // because pre-checking has its own race window — holdSoftAllOrFail's
      // atomic-per-line guard is the authoritative answer for what failed.
      const contested = await identifyContested(cartItems);
      return ok({ kind: "contention", contested });
    }
    return fail<StartCheckoutSessionResult>(holdResult.error, holdResult.code);
  }

  // Create the session row. expires_at is NULL — the conditional contention
  // timer (migration 20260601000001) sets it only when a soft_wait queue row
  // appears behind this session.
  const { data: sessionRow, error: sessionErr } = await admin
    .from("cart_checkout_sessions")
    .insert({
      customer_id: customerId,
      cart_id: cart.id,
      state: "soft",
      expires_at: null,
    })
    .select("id, expires_at")
    .single();
  if (sessionErr || !sessionRow) {
    await releaseSoftAll(lines);
    return fail<StartCheckoutSessionResult>(
      sessionErr?.message ?? "Δεν δημιουργήθηκε η συνεδρία πληρωμής.",
      sessionErr?.code ?? "SESSION_INSERT_FAILED"
    );
  }
  const session = sessionRow as { id: string; expires_at: string | null };

  await logAuditEvent({
    actor_id: userId,
    actor_type: "user",
    action: "checkout.session.started",
    resource_type: "cart_checkout_session",
    resource_id: session.id,
    metadata: {
      cart_id: cart.id,
      line_count: lines.length,
      total_qty: lines.reduce((s, l) => s + l.quantity, 0),
    },
  });

  return ok({
    kind: "ok",
    session_id: session.id,
    expires_at: session.expires_at,
  });
}

/**
 * Given the cart items that failed to soft-hold, identifies which specific
 * variants are contested (effective_available < requested_quantity) and
 * builds the payload the contention modal renders from.
 */
async function identifyContested(
  cartItems: Array<{
    variant_id: string;
    quantity: number;
    product_id: string;
    products: { name: string } | { name: string }[] | null;
    product_variants:
      | { attribute_combo: Record<string, string> | null }
      | { attribute_combo: Record<string, string> | null }[]
      | null;
  }>
): Promise<ContestedLine[]> {
  const admin = createAdminClient();
  const contested: ContestedLine[] = [];

  // Batch-resolve attribute_combo value UUIDs to display strings.
  const allValueIds = new Set<string>();
  for (const item of cartItems) {
    const variant = Array.isArray(item.product_variants)
      ? item.product_variants[0]
      : item.product_variants;
    if (!variant?.attribute_combo) continue;
    for (const id of Object.values(variant.attribute_combo)) allValueIds.add(id);
  }
  const valueLabelById = new Map<string, string>();
  if (allValueIds.size > 0) {
    const { data: vRows } = await admin
      .from("attribute_values")
      .select("id, value")
      .in("id", Array.from(allValueIds));
    for (const r of (vRows ?? []) as Array<{ id: string; value: string }>) {
      valueLabelById.set(r.id, r.value);
    }
  }

  // Resolve effective availability for the entire cart in ONE round-trip
  // (Phase 2 of the data-layer remediation — replaces a per-line RPC
  // loop on the checkout-button hot path). viewerId=null because we want
  // the global figure here: we're already past the point where the
  // viewer's own holds would matter (the soft-hold attempt just failed,
  // so any self-contention contribution is already accounted for in
  // quantity_available + quantity_soft_held).
  const variantIds = cartItems.map((i) => i.variant_id);
  const availabilityMap = await getEffectiveAvailableForVariants(variantIds, {
    viewerId: null,
  });

  for (const item of cartItems) {
    const availableNow = availabilityMap.get(item.variant_id) ?? 0;
    if (availableNow < item.quantity) {
      const product = Array.isArray(item.products) ? item.products[0] : item.products;
      const variant = Array.isArray(item.product_variants)
        ? item.product_variants[0]
        : item.product_variants;
      let variantLabel: string | null = null;
      if (variant?.attribute_combo) {
        const labels = Object.values(variant.attribute_combo)
          .map((id) => valueLabelById.get(id))
          .filter((s): s is string => typeof s === "string");
        if (labels.length > 0) variantLabel = labels.join(" · ");
      }
      contested.push({
        product_id: item.product_id,
        variant_id: item.variant_id,
        product_name: product?.name ?? "(unknown)",
        variant_label: variantLabel,
        requested_quantity: item.quantity,
        available_now: availableNow,
      });
    }
  }

  return contested;
}
