import { createClient } from "@/lib/supabase/server";

/**
 * Weighted-average cost on hand for a variant, computed from purchase_lots.
 *
 *   Σ (received_qty × unit_cost)   ← over all lots for this variant
 *   ───────────────────────────
 *   Σ received_qty
 *
 * Currency-aware (no FX conversion):
 *   - When `productCurrency` is provided, only lots in that currency are
 *     considered. If none match, returns null + reason='currency_mismatch'.
 *     This is the strict mode used by fulfillment, where the order has
 *     a known currency and snapshotting a USD cost onto a EUR order would
 *     poison downstream margin reports.
 *   - When `productCurrency` is omitted (legacy callers), the function
 *     filters to the DOMINANT currency by total received quantity.
 *     Returns the dominant currency alongside the cost — callers must
 *     check it.
 *
 * Used by:
 *   - fulfillOrder() at sale time to snapshot unit_cost_at_sale (uses strict
 *     mode by passing the order's currency)
 *   - margin reports to compute period COGS (uses dominant-currency mode)
 *
 * Returns null if there are no matching lots. Callers should fall back
 * to product.cost_price (also currency-tagged) in that case.
 */
export interface WeightedCostResult {
  avg_cost: number;
  currency: string;
  lot_count: number;
}
export interface WeightedCostUnavailable {
  reason: "no_lots" | "currency_mismatch";
  available_currencies?: string[];
}

export async function getWeightedAverageCost(
  variantId: string,
  productCurrency?: string
): Promise<WeightedCostResult | WeightedCostUnavailable | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_lots")
    .select("received_qty, unit_cost, unit_cost_currency")
    .eq("variant_id", variantId);

  const rows = (data ?? []) as Array<{
    received_qty: number;
    unit_cost: number;
    unit_cost_currency: string;
  }>;
  if (rows.length === 0) {
    // Preserve legacy `null` return for the "no lots at all" case so
    // existing consumers (margin reports) keep working unchanged.
    return null;
  }

  let targetCurrency: string;

  if (productCurrency) {
    // STRICT mode — only consider lots that match the requested
    // currency. If none match, refuse rather than synthesize a
    // misleading number.
    const matching = rows.filter(
      (r) => r.unit_cost_currency === productCurrency
    );
    if (matching.length === 0) {
      return {
        reason: "currency_mismatch",
        available_currencies: Array.from(
          new Set(rows.map((r) => r.unit_cost_currency))
        ),
      };
    }
    targetCurrency = productCurrency;
  } else {
    // LEGACY dominant-currency mode — pick the currency that
    // contributes the most quantity. Callers MUST check the
    // returned `currency` and treat as mismatch if it differs from
    // the expected one.
    const qtyByCurrency = new Map<string, number>();
    for (const r of rows) {
      qtyByCurrency.set(
        r.unit_cost_currency,
        (qtyByCurrency.get(r.unit_cost_currency) ?? 0) + r.received_qty
      );
    }
    let maxQty = -1;
    targetCurrency = "";
    for (const [cur, q] of qtyByCurrency.entries()) {
      if (q > maxQty) {
        maxQty = q;
        targetCurrency = cur;
      }
    }
  }

  const eligible = rows.filter((r) => r.unit_cost_currency === targetCurrency);
  let totalQty = 0;
  let totalCost = 0;
  for (const r of eligible) {
    totalQty += r.received_qty;
    totalCost += r.received_qty * Number(r.unit_cost);
  }
  if (totalQty === 0) return null;

  return {
    avg_cost: Math.round((totalCost / totalQty) * 10000) / 10000, // 4dp precision
    currency: targetCurrency,
    lot_count: eligible.length,
  };
}
