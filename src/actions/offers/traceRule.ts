"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type {
  Rule,
  RuleCondition,
  RuleScope,
  EvalContext,
} from "@/types/offers";

const CartContextSchema = z.object({
  lines: z
    .array(
      z.object({
        variant_id: z.string().uuid(),
        product_id: z.string().uuid(),
        category_ids: z.array(z.string().uuid()),
        quantity: z.number().int().positive(),
        unit_price: z.number().nonnegative(),
      })
    )
    .min(1),
  subtotal: z.number().nonnegative(),
  itemCount: z.number().int().positive(),
  customerId: z.string().uuid().nullable(),
  isAuthenticated: z.boolean(),
  codes: z.array(z.string()),
  evaluationTime: z.string().datetime(),
});

const Schema = z.object({
  ruleId: z.string().uuid(),
  cart: CartContextSchema,
});

export interface TraceStep {
  /** Short Greek label shown as the step name in the drawer (e.g.
   *  "Κανόνας ενεργός", "Χρ. πλαίσιο", "Πελάτης Εγγεγραμμένος"). */
  name: string;
  passed: boolean;
  /** Free-form Greek explanation. When the step failed, this is what
   *  tells the admin WHY (e.g. "Έληξε στις 24 Νοε 2025"). */
  detail: string;
}

export interface RuleTrace {
  rule_id: string;
  /** True only if EVERY step passed. The drawer uses this for the
   *  green/amber verdict color in addition to the matching applied[]
   *  entry in EvalResult — they should always agree. */
  applied: boolean;
  steps: TraceStep[];
}

/**
 * Step-by-step trace of "does this rule fire for this cart?" — used
 * by the live-preview drawer's "Why didn't it apply?" breakdown.
 *
 * Mirrors the engine's gates in order:
 *   1. rule.active = true
 *   2. OR-of-parents (at least one active offer, or no offers)
 *   3. ≥1 scope matches the cart
 *   4. requires_code → at least one entered code reaches this rule
 *   5. Each rule_condition (AND-combined)
 *
 * Each step records pass/fail + a human-readable Greek detail string.
 * The detail is the actionable information — what the admin needs to
 * change to make the rule fire.
 */
export async function traceRule(
  input: z.input<typeof Schema>
): Promise<Result<RuleTrace>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<RuleTrace>(
      "Invalid input: " + parsed.error.message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:discounts"))) {
    return fail<RuleTrace>("Forbidden", "FORBIDDEN");
  }

  const { ruleId, cart } = parsed.data;
  const admin = createAdminClient();

  // First pass: load rule + conditions + scopes + memberships in parallel.
  // We need the parent offer IDs before we can filter attachments
  // (since attachments can reach this rule via direct OR parent-offer
  // target). Splitting into two waves avoids loading the entire
  // code_attachments table.
  const [ruleRes, conditionsRes, scopesRes, membershipsRes] =
    await Promise.all([
      admin.from("rules").select("*").eq("id", ruleId).maybeSingle(),
      admin.from("rule_conditions").select("*").eq("rule_id", ruleId),
      admin.from("rule_scopes").select("*").eq("rule_id", ruleId),
      admin
        .from("offer_rule_memberships")
        .select("offer_id, offers(active)")
        .eq("rule_id", ruleId),
    ]);

  const rule = ruleRes.data as Rule | null;
  if (!rule) return fail<RuleTrace>("Rule not found", "NOT_FOUND");
  const conditions = (conditionsRes.data ?? []) as RuleCondition[];
  const scopes = (scopesRes.data ?? []) as RuleScope[];
  type MembershipRow = {
    offer_id: string;
    offers: { active: boolean } | { active: boolean }[] | null;
  };
  const memberships = (membershipsRes.data ?? []) as MembershipRow[];
  const parentOfferIds = memberships.map((m) => m.offer_id);

  // Second pass: load only attachments that COULD reach this rule.
  type AttachRow = {
    code_id: string;
    target_kind: "rule" | "offer";
    target_id: string;
    codes: { code: string } | { code: string }[] | null;
  };
  const reachingCodes = new Set<string>();
  {
    const orParts: string[] = [
      `and(target_kind.eq.rule,target_id.eq.${ruleId})`,
    ];
    if (parentOfferIds.length > 0) {
      orParts.push(
        `and(target_kind.eq.offer,target_id.in.(${parentOfferIds.join(",")}))`
      );
    }
    const { data: attachRows } = await admin
      .from("code_attachments")
      .select("code_id, target_kind, target_id, codes(code)")
      .or(orParts.join(","));
    for (const a of (attachRows ?? []) as AttachRow[]) {
      const code = Array.isArray(a.codes) ? a.codes[0] : a.codes;
      if (code) reachingCodes.add(code.code);
    }
  }

  // ─── Build steps ──────────────────────────────────────────────────
  const steps: TraceStep[] = [];

  // 1. Rule active
  steps.push({
    name: "Ο κανόνας είναι ενεργός",
    passed: rule.active,
    detail: rule.active
      ? "Ναι"
      : "Όχι — πατήστε το checkbox «Ενεργός» στην κορυφή του κανόνα",
  });

  // 2. OR-of-parents
  if (memberships.length > 0) {
    const activeParents = memberships.filter((m) => {
      const o = Array.isArray(m.offers) ? m.offers[0] : m.offers;
      return o?.active === true;
    });
    steps.push({
      name: "Γονική προσφορά ενεργή",
      passed: activeParents.length > 0,
      detail:
        activeParents.length > 0
          ? `${activeParents.length}/${memberships.length} γονική/ές προσφορά/ές ενεργές`
          : `Καμία από τις ${memberships.length} γονικές προσφορές δεν είναι ενεργή`,
    });
  }

  // 3. Scope match
  if (scopes.length === 0) {
    steps.push({
      name: "Πεδίο εφαρμογής",
      passed: false,
      detail: "Καμία τιμή πεδίου εφαρμογής δεν έχει οριστεί",
    });
  } else {
    const scopeMatch = scopes.some((s) =>
      cart.lines.some((line) => scopeMatchesLine(s, line))
    );
    steps.push({
      name: "Πεδίο εφαρμογής",
      passed: scopeMatch,
      detail: scopeMatch
        ? `Το καλάθι ταιριάζει με ${scopeLabelList(scopes)}`
        : `Το καλάθι δεν ταιριάζει με κανένα πεδίο (${scopeLabelList(scopes)})`,
    });
  }

  // 4. requires_code
  if (rule.requires_code) {
    const enteredCodesUp = new Set(
      cart.codes.map((c) => c.trim().toUpperCase())
    );
    const matching = Array.from(reachingCodes).filter((c) =>
      enteredCodesUp.has(c)
    );
    steps.push({
      name: "Κωδικός εισάχθηκε",
      passed: matching.length > 0,
      detail:
        matching.length > 0
          ? `Έγκυρος κωδικός: #${matching.join(", #")}`
          : reachingCodes.size === 0
            ? "Δεν υπάρχουν συνδεδεμένοι κωδικοί σε αυτόν τον κανόνα"
            : `Δεν εισάχθηκε κανένας από τους κωδικούς: #${Array.from(
                reachingCodes
              ).join(", #")}`,
    });
  }

  // 5+. Per-condition steps
  const ctx: EvalContext = {
    lines: cart.lines,
    subtotal: cart.subtotal,
    itemCount: cart.itemCount,
    customerId: cart.customerId,
    isAuthenticated: cart.isAuthenticated,
    codes: cart.codes,
    evaluationTime: new Date(cart.evaluationTime),
    currency: "EUR",
    inventoryByVariant: new Map(),
  };

  for (const cond of conditions) {
    steps.push(buildConditionStep(cond, ctx));
  }

  return ok({
    rule_id: ruleId,
    applied: steps.every((s) => s.passed),
    steps,
  });
}

// ─── Helpers ────────────────────────────────────────────────────────

function scopeMatchesLine(
  scope: RuleScope,
  line: { variant_id: string; product_id: string; category_ids: string[] }
): boolean {
  switch (scope.scope_kind) {
    case "all":
      return true;
    case "variant":
      return scope.resource_id === line.variant_id;
    case "product":
      return scope.resource_id === line.product_id;
    case "category":
      return (
        scope.resource_id !== null &&
        line.category_ids.includes(scope.resource_id)
      );
  }
}

function scopeLabelList(scopes: RuleScope[]): string {
  const parts: string[] = [];
  for (const s of scopes) {
    if (s.scope_kind === "all") parts.push("όλα");
    else if (s.scope_kind === "category") parts.push("κατηγορία");
    else if (s.scope_kind === "product") parts.push("προϊόν");
    else parts.push("παραλλαγή");
  }
  return parts.join(", ");
}

function buildConditionStep(
  cond: RuleCondition,
  ctx: EvalContext
): TraceStep {
  switch (cond.kind) {
    case "timeframe": {
      const now = ctx.evaluationTime;
      const { starts_at, ends_at } = cond.config;
      if (!starts_at && !ends_at) {
        return {
          name: "Χρονικό πλαίσιο",
          passed: false,
          detail: "Μη ρυθμισμένο — δεν έχει οριστεί ούτε αρχή ούτε τέλος",
        };
      }
      if (starts_at && new Date(starts_at) > now) {
        return {
          name: "Χρονικό πλαίσιο",
          passed: false,
          detail: `Ξεκινάει στις ${formatDate(starts_at)} (αυτή τη στιγμή δεν ισχύει ακόμη)`,
        };
      }
      if (ends_at && new Date(ends_at) <= now) {
        return {
          name: "Χρονικό πλαίσιο",
          passed: false,
          detail: `Έληξε στις ${formatDate(ends_at)} (αυτή τη στιγμή έχει περάσει)`,
        };
      }
      return {
        name: "Χρονικό πλαίσιο",
        passed: true,
        detail:
          starts_at && ends_at
            ? `Ισχύει ${formatDate(starts_at)} – ${formatDate(ends_at)}`
            : starts_at
              ? `Ισχύει από ${formatDate(starts_at)} και μετά`
              : `Ισχύει μέχρι ${formatDate(ends_at!)}`,
      };
    }
    case "user_type": {
      const target = cond.config.value;
      if (target === "guest") {
        return {
          name: "Τύπος χρήστη",
          passed: !ctx.isAuthenticated,
          detail: !ctx.isAuthenticated
            ? "Πελάτης = επισκέπτης ✓"
            : `Πελάτης = εγγεγραμμένος (απαιτείται επισκέπτης)`,
        };
      }
      if (target === "authenticated") {
        return {
          name: "Τύπος χρήστη",
          passed: ctx.isAuthenticated,
          detail: ctx.isAuthenticated
            ? "Πελάτης = εγγεγραμμένος ✓"
            : "Πελάτης = επισκέπτης (απαιτείται εγγεγραμμένος)",
        };
      }
      // individual
      const requiredId = (cond.config as { customer_id: string | null })
        .customer_id;
      if (!requiredId) {
        return {
          name: "Τύπος χρήστη",
          passed: false,
          detail:
            "Συγκεκριμένος χρήστης (μη ρυθμισμένο UUID — ο κανόνας δεν θα εφαρμοστεί ποτέ)",
        };
      }
      const matched = ctx.customerId === requiredId;
      return {
        name: "Τύπος χρήστη",
        passed: matched,
        detail: matched
          ? `Πελάτης ταιριάζει με ${requiredId.slice(0, 8)}…`
          : `Πελάτης ${ctx.customerId ? ctx.customerId.slice(0, 8) + "…" : "—"} ≠ απαιτούμενος ${requiredId.slice(0, 8)}…`,
      };
    }
    case "min_subtotal": {
      const passed = ctx.subtotal >= cond.config.threshold;
      return {
        name: "Ελάχιστο υποσύνολο",
        passed,
        detail: `Υποσύνολο €${ctx.subtotal.toFixed(2)} ${
          passed ? "≥" : "<"
        } €${cond.config.threshold} (απαιτούμενο)`,
      };
    }
    case "min_item_count": {
      const passed = ctx.itemCount >= cond.config.threshold;
      return {
        name: "Ελάχιστος αριθμός προϊόντων",
        passed,
        detail: `${ctx.itemCount} προϊόντα ${
          passed ? "≥" : "<"
        } ${cond.config.threshold} (απαιτούμενα)`,
      };
    }
    case "available_quantity":
      return {
        name: "Διαθέσιμη ποσότητα",
        passed: false,
        detail:
          "Σε preview mode το πραγματικό απόθεμα δεν είναι διαθέσιμο — δοκιμάστε σε ζωντανό περιβάλλον",
      };
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const months = [
    "Ιαν",
    "Φεβ",
    "Μαρ",
    "Απρ",
    "Μαΐ",
    "Ιουν",
    "Ιουλ",
    "Αυγ",
    "Σεπ",
    "Οκτ",
    "Νοε",
    "Δεκ",
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
