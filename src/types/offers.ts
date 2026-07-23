/**
 * Type definitions for the offers engine v2 (rules-first model).
 *
 * v2 shape:
 *   - `Rule` is the heavy first-class entity: name, description, active,
 *     kind, conditionals, stacking, limits, stock threshold
 *   - `RuleScope` + `RuleCode` + `RuleCustomerUsage` are owned by rules
 *   - `Offer` is a slim label: id + name + description + active
 *   - `OfferRuleMembership` is the M2M junction
 *   - A rule applies iff rule.active=true AND (no parent offer OR at
 *     least one parent.active=true)
 *
 * See docs/offers-engine-implementation-plan.md and the v2 schema
 * migration 20260611000031 for the conceptual rationale.
 */

// ─── DB row shapes ─────────────────────────────────────────────────────

export type StackingMode =
  | "stack"
  | "exclusive_within_kind"
  | "global_exclusive";

export type RuleUserType = "any" | "authenticated" | "guest";

export type StockScopeKind = "variant" | "product";

/**
 * Consolidated 3-way action discriminator (v2.4).
 *
 * Was 6-way (percent_discount, flat_discount, bundle_bxgy, waive_*);
 * now folded into three first-class action types with sub-modes in
 * the action.config. The legacy six values are migrated to:
 *   percent_discount / flat_discount → price_discount  (mode: percent|flat)
 *   bundle_bxgy                       → product_bundle
 *   waive_shipping / cod / all        → service_cost_exception
 */
export type RuleKind =
  | "price_discount"
  | "product_bundle"
  | "service_cost_exception";

export type RuleScopeKind = "all" | "category" | "product" | "variant";

export type WaiveThresholdKind = "cart_total" | "products_total";

/**
 * Slim rule entity (v2.2 — usage limits moved to codes).
 *
 * Carries:
 *   - identity (name, description, active)
 *   - action shape (kind + per-kind fields)
 *   - code-requirement flag (denorm from rule_codes existence)
 *   - post-eligibility behaviour (stacking_mode, priority)
 *
 * Conditions live in `rule_conditions`. Usage limits live on `rule_codes`
 * (each code carries its own max_uses_total / max_uses_per_customer /
 * current_uses / enforce_limits — auto-apply rules without codes have
 * no usage limits by design).
 */
export interface Rule {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  /** Mirror of rule_actions.kind for fast filtering. */
  kind: RuleKind;
  /** Code-requirement flag (denorm from rule_codes existence). */
  requires_code: boolean;
  /** Post-eligibility behaviour. */
  stacking_mode: StackingMode;
  priority: number;
  created_at: string;
}

/**
 * Discriminated union of rule actions (v2.4 — first-class typed).
 *
 * Same pattern as RuleCondition. Each rule has EXACTLY one action
 * row in `rule_actions` (UNIQUE on rule_id). To change the kind,
 * delete + re-create.
 *
 * Adding a new action kind:
 *   1. Add a new variant here
 *   2. Add a Zod schema in _actionConfigSchemas.ts
 *   3. Add a dispatch case in the engine's evaluateAction()
 *   4. Add a UI form section
 *   5. Update the DB CHECK on rule_actions.kind in a migration
 */
export interface RuleActionBase {
  id: string;
  rule_id: string;
  created_at: string;
}

export interface PriceDiscountAction extends RuleActionBase {
  kind: "price_discount";
  config: {
    mode: "percent" | "flat";
    /** For mode='percent', value is the multiplier (0.20 = 20%).
     *  For mode='flat', value is the amount in cart currency. */
    value: number;
  };
}

export interface ProductBundleAction extends RuleActionBase {
  kind: "product_bundle";
  config: {
    trigger_scope_kind: "product" | "variant" | "category";
    trigger_scope_id: string | null;
    trigger_quantity: number;
    reward_scope_kind: "product" | "variant" | "category";
    reward_scope_id: string | null;
    reward_quantity: number;
    /** 0..1; 1 means free, 0.5 means half-off. */
    reward_discount: number;
    max_applications_per_cart: number | null;
  };
}

export interface ServiceCostExceptionAction extends RuleActionBase {
  kind: "service_cost_exception";
  config: {
    fee_kind: "delivery" | "cod" | "all";
    /** Optional eligibility gate — only waive if cart/products meet the
     *  threshold. null means waive unconditionally. */
    threshold:
      | null
      | { kind: "cart_total" | "products_total"; value: number };
    /** When true, the customer is charged 0 even if the carrier API
     *  quoted a fee. When false, the engine only tracks the waiver for
     *  reporting but the customer still pays. */
    waive_customer_charge: boolean;
  };
}

export type RuleAction =
  | PriceDiscountAction
  | ProductBundleAction
  | ServiceCostExceptionAction;

export type RuleActionKind = RuleAction["kind"];

/**
 * Discriminated union of rule conditions. Each variant maps 1:1 to a
 * `kind` value stored in `rule_conditions.kind`, with the `config`
 * column holding the per-variant payload (validated via Zod at the
 * action layer + TypeScript here).
 *
 * Adding a new condition kind:
 *   1. Add a new variant here
 *   2. Add a Zod schema + UI form section
 *   3. Add an evaluator in CONDITION_EVALUATORS (lib/offers/conditionEvaluators.ts)
 *   4. Update the DB CHECK constraint on rule_conditions.kind in a migration
 */
export type RuleConditionKind =
  | "timeframe"
  | "user_type"
  | "min_subtotal"
  | "min_item_count"
  | "available_quantity";

export interface RuleConditionBase {
  id: string;
  rule_id: string;
  created_at: string;
}

export interface TimeframeCondition extends RuleConditionBase {
  kind: "timeframe";
  config: {
    starts_at?: string | null;
    ends_at?: string | null;
  };
}

export interface UserTypeCondition extends RuleConditionBase {
  kind: "user_type";
  /**
   * value='guest'         → any anonymous visitor
   * value='authenticated' → any logged-in customer
   * value='individual'    → a specific customer (customer_id required)
   */
  config:
    | { value: "guest" | "authenticated" }
    | { value: "individual"; customer_id: string | null };
}

export interface MinSubtotalCondition extends RuleConditionBase {
  kind: "min_subtotal";
  config: { threshold: number };
}

export interface MinItemCountCondition extends RuleConditionBase {
  kind: "min_item_count";
  config: { threshold: number };
}

/**
 * Available quantity condition (renamed from stock_threshold).
 *   - mode='range': rule applies while stock ∈ [min, max]
 *                   (max=null means "min or above" — no upper bound)
 *   - mode='until_oos': rule applies while stock > 0
 */
export interface AvailableQuantityCondition extends RuleConditionBase {
  kind: "available_quantity";
  config:
    | {
        mode: "range";
        min: number;
        max: number | null;
        scope_kind: "variant" | "product";
        scope_id: string | null;
      }
    | {
        mode: "until_oos";
        scope_kind: "variant" | "product";
        scope_id: string | null;
      };
}

export type RuleCondition =
  | TimeframeCondition
  | UserTypeCondition
  | MinSubtotalCondition
  | MinItemCountCondition
  | AvailableQuantityCondition;

/**
 * Slim grouping label in v2. Aggregates rules via offer_rule_memberships.
 * Disabling an offer cascades to all its rules (engine eval drops them).
 */
export interface Offer {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string;
}

/** M2M junction. A rule can belong to multiple offers; an offer can
 *  contain multiple rules. */
export interface OfferRuleMembership {
  id: string;
  offer_id: string;
  rule_id: string;
  added_at: string;
  added_by: string | null;
}

export interface RuleScope {
  id: string;
  rule_id: string;
  scope_kind: RuleScopeKind;
  resource_id: string | null;
  created_at: string;
}

/**
 * Standalone code entity (v2.5). Globally UNIQUE on `code`. Attached
 * to rules and/or offers via code_attachments — can exist without any
 * attachments (draft state).
 */
export interface Code {
  id: string;
  code: string;
  affiliate_id: string | null;
  active: boolean;
  max_uses_total: number | null;
  max_uses_per_customer: number | null;
  current_uses: number;
  enforce_limits: boolean;
  created_at: string;
  created_by: string | null;
}

/** Backward-compat alias — many places still import `RuleCode`. */
export type RuleCode = Code;

/** Junction row: a code attached to either a rule or an offer. */
export interface CodeAttachment {
  id: string;
  code_id: string;
  target_kind: "rule" | "offer";
  target_id: string;
  added_at: string;
  added_by: string | null;
}

export interface RuleCodeCustomer {
  id: string;
  code_id: string;
  customer_id: string;
  auto_apply: boolean;
  added_at: string;
  added_by: string | null;
}

export interface RuleCustomerUsage {
  id: string;
  rule_id: string;
  customer_id: string;
  use_count: number;
  last_used_at: string;
}

export type AffiliateCommissionType =
  | "percent_of_subtotal"
  | "flat_per_order";

export interface Affiliate {
  id: string;
  name: string;
  email: string | null;
  contact_phone: string | null;
  commission_rate: number;
  commission_type: AffiliateCommissionType;
  flat_commission: number | null;
  payout_method: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
}

export interface LineAllocation {
  variant_id: string;
  amount: number;
}

/** Audit trail row. offer_id is nullable in v2 (rule may have no parents,
 *  or multiple parents — we just record rule_id authoritatively). */
export interface OrderRuleApplication {
  id: string;
  order_id: string;
  offer_id: string | null;
  rule_id: string;
  code_id: string | null;
  affiliate_id: string | null;
  amount_off: number;
  currency: string;
  line_allocations: LineAllocation[];
  applied_at: string;
}

// ─── Engine I/O ────────────────────────────────────────────────────────

export interface CartLineForEval {
  variant_id: string;
  product_id: string;
  category_ids: string[];
  quantity: number;
  unit_price: number;
}

export interface EvalContext {
  lines: CartLineForEval[];
  subtotal: number;
  itemCount: number;
  customerId: string | null;
  isAuthenticated: boolean;
  codes: string[];
  evaluationTime: Date;
  currency: string;
  inventoryByVariant: Map<string, number>;
}

export interface AppliedRule {
  rule_id: string;
  /** The offer the rule was associated with at audit time. NULL when the
   *  rule had no parent offer. M2M means this captures one of possibly
   *  several. */
  offer_id: string | null;
  code_id: string | null;
  affiliate_id: string | null;
  amount_off: number;
  line_allocations: LineAllocation[];
  fee_waiver: {
    kind: "shipping" | "cod" | "all";
    amount: number;
  } | null;
}

export interface RuleWarning {
  rule_id: string;
  kind:
    | "usage_total_exceeded"
    | "usage_per_customer_exceeded"
    | "expires_soon";
  message: string;
}

export interface EvalResult {
  applied: AppliedRule[];
  total_discount: number;
  total_fee_waiver: { shipping: number; cod: number };
  per_variant_discount: Map<
    string,
    { amount_off_per_unit: number; rule_id: string }
  >;
  warnings: RuleWarning[];
}

export interface VariantOfferState {
  effective_price: number;
  original_price: number;
  /** The rule that produced this effective price (deepest discount), or
   *  null if no auto-apply rule touched the variant. */
  rule_id: string | null;
}

/** Returned by loadCandidateRules — rules that passed the coarse SQL
 *  filter (rule active + OR-of-parents + scope match). The TS engine
 *  then evaluates conditions per rule to produce the final eligible set. */
export interface CandidateRule {
  rule: Rule;
  matched_code_id: string | null;
  matched_affiliate_id: string | null;
}
