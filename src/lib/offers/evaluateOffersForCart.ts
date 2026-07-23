import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadCandidateOffers } from "./loadCandidateOffers";
import { evaluateRuleConditions } from "./conditionEvaluators";
import type {
  AppliedRule,
  CartLineForEval,
  EvalContext,
  EvalResult,
  LineAllocation,
  Rule,
  RuleAction,
  RuleCondition,
  RuleScope,
  RuleWarning,
} from "@/types/offers";

/**
 * Engine entry point (v2 rules-first model).
 *
 * Same algorithm as v1 but operating on rules instead of offers:
 *   1. loadCandidateOffers returns rules that pass rule-level
 *      conditionals + the OR-of-parents offer-membership check
 *   2. Per-line eligibility filter (scope + stock threshold per
 *      variant)
 *   3. Compute amount_off per rule based on its eligible_lines
 *   4. Stacking resolution per rule's stacking_mode
 *   5. Per-line allocation for the audit trail
 *
 * Implemented kinds in this phase: percent_discount, flat_discount,
 * waive_shipping/cod/all (flag emission). Bundle BXGY is Phase 5.
 *
 * v2 attribution note: the rule's "primary offer" for audit purposes
 * is one of its parent offers via offer_rule_memberships. We pick
 * deterministically: lowest UUID (stable sort) when M2M. For orphan
 * rules (no memberships), offer_id is null in the audit row.
 */
export async function evaluateOffersForCart(
  ctx: EvalContext
): Promise<EvalResult> {
  const candidates = await loadCandidateOffers(ctx);
  if (candidates.length === 0) {
    return emptyResult();
  }

  const ruleIds = candidates.map((c) => c.rule.id);
  const admin = createAdminClient();

  // Batched load of scopes + conditions + actions + memberships.
  const [scopesRes, conditionsRes, actionsRes, membershipsRes] =
    await Promise.all([
      admin.from("rule_scopes").select("*").in("rule_id", ruleIds),
      admin.from("rule_conditions").select("*").in("rule_id", ruleIds),
      admin.from("rule_actions").select("*").in("rule_id", ruleIds),
      admin
        .from("offer_rule_memberships")
        .select("rule_id, offer_id")
        .in("rule_id", ruleIds),
    ]);

  if (scopesRes.error || conditionsRes.error || actionsRes.error) {
    console.error(
      "[offers] failed to load scopes/conditions/actions:",
      scopesRes.error?.message ??
        conditionsRes.error?.message ??
        actionsRes.error?.message
    );
    return emptyResult();
  }

  const scopesByRule = groupBy(
    (scopesRes.data ?? []) as RuleScope[],
    (s) => s.rule_id
  );
  const conditionsByRule = groupBy(
    (conditionsRes.data ?? []) as RuleCondition[],
    (c) => c.rule_id
  );
  const actionByRule = new Map<string, RuleAction>();
  for (const a of (actionsRes.data ?? []) as RuleAction[]) {
    actionByRule.set(a.rule_id, a);
  }

  const offerByRule = new Map<string, string>();
  for (const m of (membershipsRes.data ?? []) as Array<{
    rule_id: string;
    offer_id: string;
  }>) {
    const existing = offerByRule.get(m.rule_id);
    if (!existing || m.offer_id < existing) {
      offerByRule.set(m.rule_id, m.offer_id);
    }
  }

  const evaluated: EvaluatedRule[] = [];
  const warnings: RuleWarning[] = [];

  for (const candidate of candidates) {
    const { rule, matched_code_id, matched_affiliate_id } = candidate;
    const scopes = scopesByRule.get(rule.id) ?? [];
    const conditions = conditionsByRule.get(rule.id) ?? [];

    // 1. Condition gate (AND-combined via the registry).
    if (!evaluateRuleConditions(rule, conditions, ctx)) continue;

    // 2. Per-line eligibility (scope match — stock-threshold has already
    //    been folded into the condition layer for offer-level eligibility,
    //    but per-line filtering still applies to constrain which lines
    //    receive the discount).
    const eligibleLines = filterEligibleLines(
      ctx.lines,
      scopes
    );
    if (eligibleLines.length === 0) continue;

    const result = evaluateRule(
      rule,
      actionByRule.get(rule.id),
      eligibleLines,
      ctx
    );
    if (result === null) continue;

    evaluated.push({
      rule,
      offer_id: offerByRule.get(rule.id) ?? null,
      matched_code_id,
      matched_affiliate_id,
      amount_off: result.amount_off,
      line_allocations: result.line_allocations,
      fee_waiver: result.fee_waiver,
    });

    collectWarnings(rule, conditions, ctx, warnings);
  }

  const applied = resolveStacking(evaluated);
  return buildEvalResult(applied, ctx, warnings);
}

// ─── Per-line eligibility ──────────────────────────────────────────────

interface ScopedLine extends CartLineForEval {
  line_subtotal: number;
}

function filterEligibleLines(
  lines: CartLineForEval[],
  scopes: RuleScope[]
): ScopedLine[] {
  const eligible: ScopedLine[] = [];
  for (const line of lines) {
    if (!scopes.some((s) => scopeMatchesLine(s, line))) continue;
    eligible.push({
      ...line,
      line_subtotal: round2(line.unit_price * line.quantity),
    });
  }
  return eligible;
}

function scopeMatchesLine(scope: RuleScope, line: CartLineForEval): boolean {
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

// ─── Per-rule evaluation ───────────────────────────────────────────────

interface RuleEvalResult {
  amount_off: number;
  line_allocations: LineAllocation[];
  fee_waiver: AppliedRule["fee_waiver"];
}

function evaluateRule(
  rule: Rule,
  action: RuleAction | undefined,
  eligible: ScopedLine[],
  ctx: EvalContext
): RuleEvalResult | null {
  void rule;
  if (!action) return null;
  const eligibleSubtotal = eligible.reduce((s, l) => s + l.line_subtotal, 0);

  switch (action.kind) {
    case "price_discount": {
      if (eligibleSubtotal === 0) return null;
      if (action.config.mode === "percent") {
        const rate = action.config.value;
        const amount_off = round2(eligibleSubtotal * rate);
        const line_allocations: LineAllocation[] = eligible.map((l) => ({
          variant_id: l.variant_id,
          amount: round2(l.line_subtotal * rate),
        }));
        return { amount_off, line_allocations, fee_waiver: null };
      }
      // mode === 'flat'
      const amount_off = Math.min(action.config.value, eligibleSubtotal);
      const line_allocations: LineAllocation[] = [];
      let remaining = amount_off;
      for (let i = 0; i < eligible.length; i++) {
        const l = eligible[i];
        const isLast = i === eligible.length - 1;
        const share = isLast
          ? remaining
          : round2((l.line_subtotal / eligibleSubtotal) * amount_off);
        line_allocations.push({ variant_id: l.variant_id, amount: share });
        remaining = round2(remaining - share);
      }
      return { amount_off, line_allocations, fee_waiver: null };
    }

    case "service_cost_exception": {
      const { fee_kind, threshold } = action.config;
      // Threshold gate — only when set.
      if (threshold !== null) {
        const compare =
          threshold.kind === "products_total" ? eligibleSubtotal : ctx.subtotal;
        if (compare < threshold.value) return null;
      }
      const waiverKind: "shipping" | "cod" | "all" =
        fee_kind === "delivery"
          ? "shipping"
          : fee_kind === "cod"
            ? "cod"
            : "all";
      return {
        amount_off: 0,
        line_allocations: [],
        fee_waiver: { kind: waiverKind, amount: 0 },
      };
    }

    case "product_bundle":
      return null; // Phase 5 — bundle math
  }
}

// ─── Stacking resolution ───────────────────────────────────────────────

interface EvaluatedRule {
  rule: Rule;
  offer_id: string | null;
  matched_code_id: string | null;
  matched_affiliate_id: string | null;
  amount_off: number;
  line_allocations: LineAllocation[];
  fee_waiver: AppliedRule["fee_waiver"];
}

function resolveStacking(evaluated: EvaluatedRule[]): EvaluatedRule[] {
  if (evaluated.length === 0) return [];

  const globalExclusive = evaluated.filter(
    (e) => e.rule.stacking_mode === "global_exclusive"
  );
  if (globalExclusive.length > 0) {
    return [pickBestForCustomer(globalExclusive)];
  }

  const byKind = groupBy(evaluated, (e) => e.rule.kind);
  const result: EvaluatedRule[] = [];

  for (const [, group] of byKind) {
    const excl = group.filter(
      (e) => e.rule.stacking_mode === "exclusive_within_kind"
    );
    if (excl.length > 0) {
      result.push(pickBestForCustomer(group));
    } else {
      result.push(...group);
    }
  }

  return result;
}

function pickBestForCustomer(rules: EvaluatedRule[]): EvaluatedRule {
  return rules.reduce((best, current) =>
    ruleValueForCustomer(current) > ruleValueForCustomer(best) ? current : best
  );
}

function ruleValueForCustomer(e: EvaluatedRule): number {
  if (e.amount_off > 0) return e.amount_off;
  if (e.fee_waiver) {
    switch (e.fee_waiver.kind) {
      case "all":
        return 1000;
      case "shipping":
        return 100;
      case "cod":
        return 100;
    }
  }
  return e.rule.priority;
}

// ─── Warnings ──────────────────────────────────────────────────────────

function collectWarnings(
  rule: Rule,
  conditions: RuleCondition[],
  ctx: EvalContext,
  warnings: RuleWarning[]
): void {
  // Usage limits live on rule_codes in v2.2 — soft-limit warnings now
  // happen at the code-match layer (loadCandidateOffers) where we know
  // which code matched.

  // Expiring-soon warning from any timeframe condition with ends_at in
  // the next 24h.
  const timeframeCond = conditions.find((c) => c.kind === "timeframe");
  if (timeframeCond?.kind === "timeframe" && timeframeCond.config.ends_at) {
    const endsAt = new Date(timeframeCond.config.ends_at).getTime();
    const hoursRemaining = (endsAt - ctx.evaluationTime.getTime()) / 3_600_000;
    if (hoursRemaining > 0 && hoursRemaining < 24) {
      warnings.push({
        rule_id: rule.id,
        kind: "expires_soon",
        message: `Ο κανόνας «${rule.name}» λήγει σε λιγότερο από 24 ώρες.`,
      });
    }
  }
}

// ─── Result assembly ───────────────────────────────────────────────────

function buildEvalResult(
  applied: EvaluatedRule[],
  ctx: EvalContext,
  warnings: RuleWarning[]
): EvalResult {
  const appliedRules: AppliedRule[] = applied.map((e) => ({
    rule_id: e.rule.id,
    offer_id: e.offer_id,
    code_id: e.matched_code_id,
    affiliate_id: e.matched_affiliate_id,
    amount_off: e.amount_off,
    line_allocations: e.line_allocations,
    fee_waiver: e.fee_waiver,
  }));

  const total_discount = round2(
    appliedRules.reduce((s, a) => s + a.amount_off, 0)
  );

  const total_fee_waiver = { shipping: 0, cod: 0 };
  for (const a of appliedRules) {
    if (a.fee_waiver?.kind === "shipping") total_fee_waiver.shipping = 1;
    if (a.fee_waiver?.kind === "cod") total_fee_waiver.cod = 1;
    if (a.fee_waiver?.kind === "all") {
      total_fee_waiver.shipping = 1;
      total_fee_waiver.cod = 1;
    }
  }

  const per_variant_discount = new Map<
    string,
    { amount_off_per_unit: number; rule_id: string }
  >();
  for (const a of appliedRules) {
    for (const alloc of a.line_allocations) {
      const line = ctx.lines.find((l) => l.variant_id === alloc.variant_id);
      if (!line || line.quantity === 0) continue;
      const per_unit = round2(alloc.amount / line.quantity);
      const existing = per_variant_discount.get(alloc.variant_id);
      if (!existing || per_unit > existing.amount_off_per_unit) {
        per_variant_discount.set(alloc.variant_id, {
          amount_off_per_unit: per_unit,
          rule_id: a.rule_id,
        });
      }
    }
  }

  return {
    applied: appliedRules,
    total_discount,
    total_fee_waiver,
    per_variant_discount,
    warnings,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────

function emptyResult(): EvalResult {
  return {
    applied: [],
    total_discount: 0,
    total_fee_waiver: { shipping: 0, cod: 0 },
    per_variant_discount: new Map(),
    warnings: [],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const arr = out.get(k);
    if (arr) arr.push(item);
    else out.set(k, [item]);
  }
  return out;
}
