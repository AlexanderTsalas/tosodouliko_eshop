import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { CONDITION_EVALUATORS } from "./conditionEvaluators";
import type {
  Rule,
  RuleAction,
  RuleCondition,
  RuleScope,
  VariantOfferState,
} from "@/types/offers";

/**
 * Variant-level offer evaluation for the storefront catalog (v2.1).
 *
 * Returns per-variant: effective_price + original_price + the rule that
 * produced the deepest discount (or null).
 *
 * Scope: auto-apply rules only (`requires_code=false`), with the
 * OR-of-parents offer-membership check enforced inline + conditions
 * AND-evaluated via the registry.
 *
 * Stacking is NOT applied here — the storefront just shows the BEST
 * single-rule discounted price. Real stacking happens at cart eval.
 */
export async function evaluateOffersForVariantSet(
  variantIds: string[],
  ctx: {
    variantContext: Map<
      string,
      { product_id: string; category_ids: string[]; unit_price: number }
    >;
    evaluationTime: Date;
    currency: string;
    inventoryByVariant: Map<string, number>;
  }
): Promise<Map<string, VariantOfferState>> {
  const result = new Map<string, VariantOfferState>();
  for (const variantId of variantIds) {
    const v = ctx.variantContext.get(variantId);
    if (!v) continue;
    result.set(variantId, {
      effective_price: v.unit_price,
      original_price: v.unit_price,
      rule_id: null,
    });
  }
  if (variantIds.length === 0) return result;

  const admin = createAdminClient();

  // Auto-apply rules only — `requires_code=false`. RLS would also gate
  // this for anon users; we filter explicitly because the engine uses
  // the admin client.
  const { data: rules, error: rulesErr } = await admin
    .from("rules")
    .select("*")
    .eq("active", true)
    .eq("requires_code", false);

  if (rulesErr || !rules || rules.length === 0) return result;

  const ruleIds = (rules as Rule[]).map((r) => r.id);
  const [scopesRes, conditionsRes, actionsRes, membershipsRes] =
    await Promise.all([
      admin.from("rule_scopes").select("*").in("rule_id", ruleIds),
      admin.from("rule_conditions").select("*").in("rule_id", ruleIds),
      admin.from("rule_actions").select("*").in("rule_id", ruleIds),
      admin
        .from("offer_rule_memberships")
        .select("rule_id, offer_id, offers!inner(active)")
        .in("rule_id", ruleIds),
    ]);

  if (scopesRes.error || conditionsRes.error || actionsRes.error) {
    console.error(
      "[offers] variant-set eval failed loading scopes/conditions/actions:",
      scopesRes.error?.message ??
        conditionsRes.error?.message ??
        actionsRes.error?.message
    );
    return result;
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

  // OR-of-parents
  const rulesWithParents = new Set<string>();
  const rulesWithActiveParent = new Set<string>();
  for (const m of (membershipsRes.data ?? []) as Array<{
    rule_id: string;
    offer_id: string;
    offers: { active: boolean } | { active: boolean }[];
  }>) {
    rulesWithParents.add(m.rule_id);
    const offerRel = Array.isArray(m.offers) ? m.offers[0] : m.offers;
    if (offerRel?.active) rulesWithActiveParent.add(m.rule_id);
  }

  // Build a per-variant "synthetic cart" context so condition evaluators
  // that don't need cart shape (timeframe, user_type, etc.) still work.
  // Conditions like `min_subtotal` will naturally fail at the catalog
  // tile level — discount badges only show when ALL conditions of the
  // rule pass against a one-variant view. This is the right product
  // behaviour: a "20% off cart over €50" rule shouldn't badge €10
  // products in the catalog.
  for (const variantId of variantIds) {
    const v = ctx.variantContext.get(variantId);
    if (!v) continue;

    let bestDiscount = 0;
    let bestRuleId: string | null = null;

    for (const rule of rules as Rule[]) {
      if (
        rulesWithParents.has(rule.id) &&
        !rulesWithActiveParent.has(rule.id)
      ) {
        continue;
      }
      const scopes = scopesByRule.get(rule.id) ?? [];
      const conditions = conditionsByRule.get(rule.id) ?? [];

      // Scope match for this variant
      const inScope = scopes.some((s) => {
        switch (s.scope_kind) {
          case "all":
            return true;
          case "variant":
            return s.resource_id === variantId;
          case "product":
            return s.resource_id === v.product_id;
          case "category":
            return (
              s.resource_id !== null && v.category_ids.includes(s.resource_id)
            );
        }
      });
      if (!inScope) continue;

      // Build a single-variant context for evaluator dispatch.
      const variantCtx = {
        lines: [
          {
            variant_id: variantId,
            product_id: v.product_id,
            category_ids: v.category_ids,
            quantity: 1,
            unit_price: v.unit_price,
          },
        ],
        subtotal: v.unit_price,
        itemCount: 1,
        customerId: null,
        isAuthenticated: false,
        codes: [],
        evaluationTime: ctx.evaluationTime,
        currency: ctx.currency,
        inventoryByVariant: ctx.inventoryByVariant,
      };

      let conditionsPass = true;
      for (const cond of conditions) {
        const evaluator = CONDITION_EVALUATORS[cond.kind];
        if (!evaluator || !evaluator(cond, variantCtx, rule)) {
          conditionsPass = false;
          break;
        }
      }
      if (!conditionsPass) continue;

      // Compute the per-unit discount this rule's action produces.
      // Bundle and fee-waiver actions don't affect catalog price.
      const action = actionByRule.get(rule.id);
      let discount = 0;
      if (action && action.kind === "price_discount") {
        if (action.config.mode === "percent") {
          discount = round2(v.unit_price * action.config.value);
        } else {
          discount = Math.min(action.config.value, v.unit_price);
        }
      }
      if (discount > bestDiscount) {
        bestDiscount = discount;
        bestRuleId = rule.id;
      }
    }

    if (bestDiscount > 0 && bestRuleId !== null) {
      result.set(variantId, {
        effective_price: round2(v.unit_price - bestDiscount),
        original_price: v.unit_price,
        rule_id: bestRuleId,
      });
    }
  }

  return result;
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
