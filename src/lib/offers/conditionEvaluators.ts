import "server-only";
import type {
  EvalContext,
  Rule,
  RuleCondition,
  RuleConditionKind,
} from "@/types/offers";

/**
 * Per-kind dispatch table for evaluating a rule's conditions against a
 * cart context. Adding a new condition kind = one entry here + one
 * Zod schema + one UI form section. No changes to engine core, no SQL.
 *
 * Usage limits are NOT here — they live on rule_codes (v2.2) and are
 * checked in loadCandidateOffers at the code-match layer.
 */

export type ConditionEvalContext = EvalContext;

type Evaluator = (
  condition: RuleCondition,
  ctx: ConditionEvalContext,
  rule: Rule
) => boolean;

export const CONDITION_EVALUATORS: Record<RuleConditionKind, Evaluator> = {
  timeframe: (cond, ctx) => {
    if (cond.kind !== "timeframe") return false;
    const { starts_at, ends_at } = cond.config;
    if (
      starts_at &&
      new Date(starts_at).getTime() > ctx.evaluationTime.getTime()
    ) {
      return false;
    }
    if (
      ends_at &&
      new Date(ends_at).getTime() <= ctx.evaluationTime.getTime()
    ) {
      return false;
    }
    return true;
  },

  user_type: (cond, ctx) => {
    if (cond.kind !== "user_type") return false;
    const { value } = cond.config;
    if (value === "authenticated") return ctx.isAuthenticated;
    if (value === "guest") return !ctx.isAuthenticated;
    if (value === "individual") {
      // Specific-customer mode. customer_id MUST match the cart's
      // customer. Unconfigured (null) → condition fails so an incomplete
      // rule can't accidentally fire.
      if (cond.config.customer_id === null) return false;
      return ctx.customerId === cond.config.customer_id;
    }
    return true;
  },

  min_subtotal: (cond, ctx) => {
    if (cond.kind !== "min_subtotal") return false;
    return ctx.subtotal >= cond.config.threshold;
  },

  min_item_count: (cond, ctx) => {
    if (cond.kind !== "min_item_count") return false;
    return ctx.itemCount >= cond.config.threshold;
  },

  available_quantity: (cond, ctx, rule) => {
    if (cond.kind !== "available_quantity") return false;
    void rule;
    const { scope_kind, scope_id } = cond.config;
    if (!scope_id) return false; // unconfigured → fails

    // Predicate against a single stock number.
    const matchesQty = (stock: number): boolean => {
      if (cond.config.mode === "until_oos") {
        return stock > 0;
      }
      // mode === 'range'
      const { min, max } = cond.config;
      if (stock < min) return false;
      if (max !== null && stock > max) return false;
      return true;
    };

    if (scope_kind === "variant") {
      const stock = ctx.inventoryByVariant.get(scope_id);
      return stock !== undefined && matchesQty(stock);
    }
    if (scope_kind === "product") {
      for (const line of ctx.lines) {
        if (line.product_id !== scope_id) continue;
        const stock = ctx.inventoryByVariant.get(line.variant_id);
        if (stock !== undefined && matchesQty(stock)) return true;
      }
      return false;
    }
    return false;
  },
};

/**
 * Evaluates ALL conditions for a rule (AND-combined). Returns true if
 * the rule passes (continues to per-line filtering downstream).
 */
export function evaluateRuleConditions(
  rule: Rule,
  conditions: RuleCondition[],
  ctx: ConditionEvalContext
): boolean {
  for (const cond of conditions) {
    const evaluator = CONDITION_EVALUATORS[cond.kind];
    if (!evaluator) {
      console.error(`[offers] Unknown condition kind: ${cond.kind}`);
      return false;
    }
    if (!evaluator(cond, ctx, rule)) return false;
  }
  return true;
}
