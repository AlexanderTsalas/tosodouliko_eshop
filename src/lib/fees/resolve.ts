import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchCarrierQuote } from "@/lib/courier/quote";
import { getCapabilities } from "@/lib/courier/getCapabilities";
import type { Carrier } from "@/types/order-history";
import type {
  FeeAppliesWhen,
  FeeBreakdownEntry,
  FeeCategory,
  FeeResolveResult,
  FeeRule,
} from "@/types/fee";

/**
 * Inputs the resolver needs to evaluate fee_categories' applies_when matchers
 * and rule filters. Built by the order-creation flow from the cart + customer
 * choices. Numeric fields are in the shop's base currency.
 */
export interface FeeResolveContext {
  payment_method: "stripe" | "cod" | "cash_on_pickup" | "bank_transfer";
  delivery_method:
    | "home_delivery"
    | "store_pickup"
    | "delivery_station_pickup"
    | "carrier_pickup";
  carrier: Carrier | null;
  /** Sum of order_items.total. */
  subtotal: number;
  /** Sum of items' COD-collected value (typically = order total; for now = subtotal). */
  cod_amount: number;
  /** Product + variant ids in the cart — used for scope='product' / 'variant' rule matching. */
  product_ids: string[];
  variant_ids: string[];
  /** Category ids the cart's products belong to — used for scope='category' rule matching. */
  category_ids: string[];

  /**
   * Inputs the carrier API quote needs. All optional — when absent or
   * incomplete the quote step is skipped and the resolver falls back to
   * custom rules for every category. Phase 3 wired this in; Phase 1 callers
   * pre-passed only the rule-matching subset.
   */
  recipient_zipcode?: string;
  recipient_country?: string;
  /** Sum of variant weights × quantities, in kg. */
  weight_kg?: number;
  /** Cumulative parcel count (typically = sum of line quantities for simplicity). */
  item_quantity?: number;
  /** Customer-chosen ACS station code (numeric branch) for delivery_station_pickup orders. */
  station_destination?: string | null;
}

/**
 * Resolves the per-order fee breakdown from current fee_categories + fee_rules.
 *
 * Phase 3 adds the carrier-API branch:
 *   - When the order has a `carrier` and the merchant has an active provider
 *     configured for it, the resolver fetches a single price quote at the top
 *     of the function (best-effort, time-boxed inside the provider).
 *   - For each fee_category whose `pricing_source='api'`, the API quote
 *     populates the charged amount when the category slug maps to a known
 *     quote field (shipping → quote.shipping, cod_handling → quote.cod_handling).
 *     If the quote is missing or returns 0, the resolver falls back to custom
 *     rules under the same category — never throws or fails the order.
 *   - Audit (Option B): for `pricing_source='custom'` categories, the
 *     resolver still populates `api_quote` from the same quote so reports can
 *     compare actual-charge vs. carrier-quoted-charge over time.
 *
 * Resolution algorithm (unchanged for the custom branch):
 *   1. Fetch all active categories ordered by display_order.
 *   2. For each category, check applies_when against the context.
 *   3. Fetch all active rules under that category and filter by per-rule
 *      payment/delivery/carrier matchers.
 *   4. Group matching rules by scope, pick the most-specific scope present:
 *      variant > product > category > global.
 *      Within the chosen scope, take the rule with the lowest `priority`.
 *   5. Compute the rule's amount (flat or percentage of percentage_base).
 *   6. If any matching rule has combination='add', stack its amount on top.
 *   7. Round to 2 decimals (half-up).
 *   8. Write the entry to fees_breakdown.
 */
export async function resolveFees(
  ctx: FeeResolveContext
): Promise<FeeResolveResult> {
  const admin = createAdminClient();

  const { data: catRows, error: catErr } = await admin
    .from("fee_categories")
    .select("*")
    .eq("active", true)
    .order("display_order", { ascending: true });
  if (catErr) {
    console.error("[fees] failed to load categories:", catErr.message);
    return { fees_total: 0, fees_breakdown: [] };
  }
  const categories = (catRows ?? []) as FeeCategory[];

  // Pre-load all rules for active categories in one query, group in JS.
  const catIds = categories.map((c) => c.id);
  const rulesByCat = new Map<string, FeeRule[]>();
  if (catIds.length > 0) {
    const { data: ruleRows } = await admin
      .from("fee_rules")
      .select("*")
      .in("fee_category_id", catIds)
      .eq("active", true)
      .order("priority", { ascending: true });
    for (const r of (ruleRows ?? []) as FeeRule[]) {
      const list = rulesByCat.get(r.fee_category_id) ?? [];
      list.push(r);
      rulesByCat.set(r.fee_category_id, list);
    }
  }

  // ---------------------------------------------------------------------------
  // Carrier API quote (single call per order, used by both api and audit branches).
  // ---------------------------------------------------------------------------
  const apiQuotes = await fetchApiQuotes(ctx);

  // Phase 4 — gate the audit api_quote persistence on the carrier's
  // store_api_quote_for_audit capability. When off (typical for the
  // "Merchant A" scenario who doesn't want to even record what the API
  // would have charged), api_quote stays null on every breakdown entry,
  // even when a quote was successfully fetched for the api-pricing branch.
  //
  // Note: this only affects audit population for custom-priced categories.
  // For categories with pricing_source='api', `charged` itself comes from
  // apiAmount — we can't omit it without breaking the category's pricing
  // contract. api_quote will equal charged in that case (per design).
  const auditCapabilityOn = ctx.carrier
    ? (await getCapabilities(ctx.carrier)).has("store_api_quote_for_audit")
    : false;

  const breakdown: FeeBreakdownEntry[] = [];
  let runningShipping = 0;

  for (const category of categories) {
    if (!matchesAppliesWhen(category.applies_when, ctx)) continue;

    const rules = rulesByCat.get(category.id) ?? [];
    const matching = rules.filter((r) => ruleMatchesContext(r, ctx));

    // Compute custom-rule amount up front. The api branch may not use it (it
    // overrides with the carrier quote) but if the quote is unavailable we
    // fall back here.
    const customPick = pickAmount({
      category,
      rules: matching,
      ctx,
      runningShipping,
    });

    const apiAmount = apiAmountForCategory(category.slug, apiQuotes);

    let charged: number;
    let source: FeeBreakdownEntry["source"];
    let ruleId: string | null;

    if (category.pricing_source === "api" && apiAmount !== null) {
      charged = apiAmount;
      source = "api";
      ruleId = null;
    } else {
      charged = customPick.amount;
      source = customPick.ruleId ? "custom_rule" : "custom_no_rule";
      ruleId = customPick.ruleId;
    }

    const rounded = round2(charged);
    if (rounded === 0 && matching.length === 0 && source !== "api") {
      // No rule matched AND no api quote — skip writing an entry so we don't
      // clutter the breakdown with €0 lines for categories that didn't fire.
      continue;
    }

    breakdown.push({
      category_slug: category.slug,
      label: category.label,
      display_order: category.display_order,
      charged: rounded,
      // Option B audit: store the carrier quote alongside the charged amount
      // so reports can detect divergence between custom rules and API pricing.
      // Phase 4: gated on the store_api_quote_for_audit capability. When off,
      // we leave api_quote null even if a quote was fetched. For api-source
      // categories, api_quote always mirrors charged (it IS the charge).
      api_quote: source === "api" ? apiAmount : auditCapabilityOn ? apiAmount : null,
      source,
      rule_id: ruleId,
    });

    if (category.slug === "shipping") {
      runningShipping = rounded;
    }
  }

  const fees_total = round2(breakdown.reduce((s, e) => s + e.charged, 0));
  return { fees_total, fees_breakdown: breakdown };
}

// -----------------------------------------------------------------------------
// Carrier-quote helpers
// -----------------------------------------------------------------------------

interface ApiQuoteFields {
  shipping: number;
  cod_handling: number;
}

/**
 * Calls fetchCarrierQuote once for the order's carrier. Returns null when
 * the order has no carrier (e.g., store_pickup), the carrier isn't
 * configured, or the quote fails. The resolver treats null as "no API data"
 * and gracefully falls back to custom rules + leaves api_quote=null on the
 * breakdown entries.
 */
async function fetchApiQuotes(ctx: FeeResolveContext): Promise<ApiQuoteFields | null> {
  if (!ctx.carrier) return null;
  if (!ctx.recipient_zipcode || !ctx.weight_kg || ctx.weight_kg <= 0) return null;

  const result = await fetchCarrierQuote({
    carrier: ctx.carrier,
    recipient_zipcode: ctx.recipient_zipcode,
    recipient_country: ctx.recipient_country,
    weight_kg: ctx.weight_kg,
    cod_amount: ctx.cod_amount,
    item_quantity: ctx.item_quantity,
    station_destination: ctx.station_destination,
  });
  if (!result) return null;

  return {
    shipping: round2(result.quote.shipping),
    cod_handling: round2(result.quote.cod_handling),
  };
}

/**
 * Maps a fee_category slug to its corresponding field in the API quote.
 * Returns null for slugs that don't have a carrier-quoted equivalent (e.g.,
 * merchant-defined "service_fee" or "gift_card_handling") — those categories
 * remain custom-rule-only regardless of pricing_source.
 */
function apiAmountForCategory(
  slug: string,
  quotes: ApiQuoteFields | null
): number | null {
  if (!quotes) return null;
  switch (slug) {
    case "shipping":
      return quotes.shipping;
    case "cod_handling":
      return quotes.cod_handling;
    default:
      return null;
  }
}

// -----------------------------------------------------------------------------
// Existing helpers (unchanged from Phase 1)
// -----------------------------------------------------------------------------

function matchesAppliesWhen(
  applies: FeeAppliesWhen | null | undefined,
  ctx: FeeResolveContext
): boolean {
  if (!applies || Object.keys(applies).length === 0) return true;
  if (applies.payment_method && applies.payment_method !== ctx.payment_method) return false;
  if (applies.delivery_method && applies.delivery_method !== ctx.delivery_method) return false;
  if (applies.carrier && applies.carrier !== ctx.carrier) return false;
  if (typeof applies.min_subtotal === "number" && ctx.subtotal < applies.min_subtotal) return false;
  if (typeof applies.max_subtotal === "number" && ctx.subtotal >= applies.max_subtotal) return false;
  return true;
}

function ruleMatchesContext(rule: FeeRule, ctx: FeeResolveContext): boolean {
  if (
    rule.applies_to_payment_methods &&
    rule.applies_to_payment_methods.length > 0 &&
    !rule.applies_to_payment_methods.includes(ctx.payment_method)
  )
    return false;
  if (
    rule.applies_to_delivery_methods &&
    rule.applies_to_delivery_methods.length > 0 &&
    !rule.applies_to_delivery_methods.includes(ctx.delivery_method)
  )
    return false;
  if (
    rule.applies_to_carriers &&
    rule.applies_to_carriers.length > 0 &&
    (ctx.carrier === null || !rule.applies_to_carriers.includes(ctx.carrier))
  )
    return false;

  switch (rule.scope_type) {
    case "global":
      return true;
    case "category":
      return rule.scope_id !== null && ctx.category_ids.includes(rule.scope_id);
    case "product":
      return rule.scope_id !== null && ctx.product_ids.includes(rule.scope_id);
    case "variant":
      return rule.scope_id !== null && ctx.variant_ids.includes(rule.scope_id);
  }
}

function pickAmount(args: {
  category: FeeCategory;
  rules: FeeRule[];
  ctx: FeeResolveContext;
  runningShipping: number;
}): { amount: number; ruleId: string | null } {
  if (args.rules.length === 0) return { amount: 0, ruleId: null };

  const bySpec: Record<"variant" | "product" | "category" | "global", FeeRule[]> = {
    variant: [],
    product: [],
    category: [],
    global: [],
  };
  for (const r of args.rules) bySpec[r.scope_type].push(r);

  const overridesByPriority = (list: FeeRule[]) =>
    list.filter((r) => r.combination === "override").sort((a, b) => a.priority - b.priority);

  let chosen: FeeRule | null = null;
  for (const tier of ["variant", "product", "category", "global"] as const) {
    const overrides = overridesByPriority(bySpec[tier]);
    if (overrides.length > 0) {
      chosen = overrides[0];
      break;
    }
  }

  if (!chosen) {
    const sum = args.rules
      .filter((r) => r.combination === "add")
      .reduce((s, r) => s + computeRuleAmount(r, args.category, args.ctx, args.runningShipping), 0);
    return { amount: sum, ruleId: null };
  }

  let amount = computeRuleAmount(chosen, args.category, args.ctx, args.runningShipping);

  for (const r of args.rules) {
    if (r.id === chosen.id) continue;
    if (r.combination !== "add") continue;
    amount += computeRuleAmount(r, args.category, args.ctx, args.runningShipping);
  }

  return { amount, ruleId: chosen.id };
}

function computeRuleAmount(
  rule: FeeRule,
  category: FeeCategory,
  ctx: FeeResolveContext,
  runningShipping: number
): number {
  if (rule.rate_type === "flat") return Number(rule.amount);
  const pct = Number(rule.amount) / 100;
  let base = 0;
  switch (category.percentage_base) {
    case "order_subtotal":
      base = ctx.subtotal;
      break;
    case "subtotal_plus_shipping":
      base = ctx.subtotal + runningShipping;
      break;
    case "cod_amount":
      base = ctx.cod_amount;
      break;
    case "fixed_amount":
    default:
      base = 0;
      break;
  }
  return pct * base;
}

function round2(n: number): number {
  return Math.round(n * 100 + Number.EPSILON) / 100;
}
