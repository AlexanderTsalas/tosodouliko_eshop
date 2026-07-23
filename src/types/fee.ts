/**
 * Custom-fee model. Two seeded categories (shipping, cod_handling) anchor the
 * carrier integration; everything else is user-defined.
 *
 * Order at runtime:
 *   1. fee_categories are evaluated in `display_order` (ascending).
 *   2. For each applicable category (applies_when matches the order context),
 *      the rules under it are resolved — most-specific scope wins by default
 *      (variant > product > category > global) with optional "add" stacking.
 *   3. The resolved per-category amount lands in orders.fees_breakdown[].
 *   4. orders.fees_total is the sum.
 */

export type FeeCategoryPricingSource = "custom" | "api";

export type FeePercentageBase =
  | "order_subtotal"
  | "subtotal_plus_shipping"
  | "cod_amount"
  | "fixed_amount";

/**
 * `applies_when` matchers — ALL keys must hold for the category to fire on
 * a given order. Empty object = always applies. Phase 1 supports the keys
 * below; more matchers can be added without schema changes.
 */
export interface FeeAppliesWhen {
  payment_method?: "stripe" | "cod" | "cash_on_pickup" | "bank_transfer";
  delivery_method?:
    | "home_delivery"
    | "store_pickup"
    | "delivery_station_pickup"
    | "carrier_pickup";
  carrier?: "acs" | "elta" | "box_now" | "speedex" | "geniki" | "other";
  /** Cart subtotal must be at least this value (in shop's base currency). */
  min_subtotal?: number;
  /** Cart subtotal must be below this value — drives free-shipping-over-threshold. */
  max_subtotal?: number;
}

export interface FeeCategory {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  applies_when: FeeAppliesWhen;
  display_order: number;
  percentage_base: FeePercentageBase;
  pricing_source: FeeCategoryPricingSource;
  is_system: boolean;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type FeeRuleScopeType = "global" | "category" | "product" | "variant";
export type FeeRuleRateType = "flat" | "percentage";
export type FeeRuleCombination = "override" | "add";

export interface FeeRule {
  id: string;
  fee_category_id: string;
  scope_type: FeeRuleScopeType;
  /** Polymorphic ref: categories.id / products.id / product_variants.id depending on scope_type. NULL for global. */
  scope_id: string | null;
  rate_type: FeeRuleRateType;
  amount: number;
  applies_to_payment_methods: string[] | null;
  applies_to_delivery_methods: string[] | null;
  applies_to_carriers: string[] | null;
  priority: number;
  combination: FeeRuleCombination;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Per-category entry in orders.fees_breakdown. Always stores both `charged`
 * and `api_quote` keys when an API quote was obtainable — keeps the report
 * query shape uniform regardless of whether the category was in custom or
 * API mode.
 */
export interface FeeBreakdownEntry {
  category_slug: string;
  label: string;
  display_order: number;
  /** The amount actually charged to the customer. */
  charged: number;
  /**
   * What the carrier API quoted at order time, if obtainable. Equal to
   * `charged` when source='api'; potentially different when source='custom_rule'.
   * Null when no API was configured / data was insufficient.
   */
  api_quote: number | null;
  source: "custom_rule" | "api" | "custom_no_rule";
  /** Which rule was selected (when source='custom_rule'). */
  rule_id: string | null;
  /** Optional detail — useful when audit reconciliation shows a discrepancy. */
  meta?: Record<string, unknown>;
}

/** Output of the fee resolver, snapshotted into the order. */
export interface FeeResolveResult {
  fees_total: number;
  fees_breakdown: FeeBreakdownEntry[];
}

/**
 * Current schema version of orders.fees_breakdown. Bump on breaking
 * changes (semantic / unit shifts). Stays at 1 for purely additive
 * changes. Used by readers to branch on version when the shape
 * evolves — see parseFeesBreakdown() below.
 */
export const FEES_BREAKDOWN_VERSION = 1 as const;

/**
 * Defensive reader for an order's fees_breakdown jsonb. Returns a
 * normalized array of entries regardless of the row's recorded version.
 * Callers should use this instead of casting raw jsonb to
 * FeeBreakdownEntry[] — when the schema evolves, only this function
 * needs to learn about prior versions; consumer code stays unchanged.
 *
 * Today's only version is v1 → pass-through. Future versions live
 * here as additional branches:
 *
 *   if (version === 2) {
 *     // map cents-form back to major units for v1-shaped consumers
 *   }
 */
export function parseFeesBreakdown(
  raw: unknown,
  version: number | null | undefined = FEES_BREAKDOWN_VERSION
): FeeBreakdownEntry[] {
  if (!Array.isArray(raw)) return [];
  // v1 (current) — return entries as-is, with defensive defaults for
  // any missing optional fields. Reader works for null/undefined version
  // (treat as v1) since old rows pre-date the version column.
  const v = version ?? 1;
  if (v === 1) {
    return raw.map((entry) => {
      const e = entry as Partial<FeeBreakdownEntry>;
      return {
        category_slug: e.category_slug ?? "unknown",
        label: e.label ?? e.category_slug ?? "unknown",
        display_order: typeof e.display_order === "number" ? e.display_order : 0,
        charged: typeof e.charged === "number" ? e.charged : 0,
        api_quote: typeof e.api_quote === "number" ? e.api_quote : null,
        source:
          e.source === "api" ||
          e.source === "custom_rule" ||
          e.source === "custom_no_rule"
            ? e.source
            : "custom_no_rule",
        rule_id: typeof e.rule_id === "string" ? e.rule_id : null,
        meta: e.meta && typeof e.meta === "object" ? e.meta : undefined,
      };
    });
  }
  // Unknown future version — return [] rather than risk surfacing
  // misinterpreted data. Bug will surface as zero-fees in reports
  // (visible) rather than as wrong totals (silent).
  return [];
}
