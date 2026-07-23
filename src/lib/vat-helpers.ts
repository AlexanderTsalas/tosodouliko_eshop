import type { VatRate, ResolvedVatRate } from "@/types/vat-rates";
import type { Category } from "@/types/category-navigation";
import type { Product } from "@/types/products";

/**
 * Resolution order:
 *   1. product.vat_rate_id     (explicit per-product override)
 *   2. category.vat_rate_id    (inherited from a tax-classifying category)
 *   3. system default          (the row marked is_default = true)
 *
 * For multi-category products with multiple rates, the lowest rate wins —
 * the conservative choice for the tax authority — and the conflicting other
 * rate IDs are returned so the admin UI can warn.
 *
 * Returns null only if the system has no rates at all (misconfiguration).
 */
export function resolveEffectiveVatRate(
  product: Pick<Product, "vat_rate_id">,
  productCategories: Pick<Category, "id" | "vat_rate_id">[],
  allRates: VatRate[]
): ResolvedVatRate | null {
  const byId = new Map(allRates.map((r) => [r.id, r]));

  // 1. Product-level override.
  if (product.vat_rate_id) {
    const r = byId.get(product.vat_rate_id);
    if (r) {
      return { rate: r, source: "product", conflictingCategoryRateIds: [] };
    }
  }

  // 2. Category-derived.
  const catRates = productCategories
    .map((c) => (c.vat_rate_id ? byId.get(c.vat_rate_id) : undefined))
    .filter((r): r is VatRate => !!r);

  if (catRates.length > 0) {
    // Lowest rate wins; conflict list is everything else with a rate.
    catRates.sort((a, b) => a.rate - b.rate);
    const winner = catRates[0];
    const conflicting = catRates
      .slice(1)
      .filter((r) => r.id !== winner.id)
      .map((r) => r.id);
    return { rate: winner, source: "category", conflictingCategoryRateIds: conflicting };
  }

  // 3. System default.
  const def = allRates.find((r) => r.is_default);
  if (def) return { rate: def, source: "default", conflictingCategoryRateIds: [] };

  return null;
}

/**
 * Margin metrics for a single product line at a given sale price (VAT-inclusive)
 * and unit cost. The sale price is divided by (1 + rate) to back the VAT out
 * before comparison — Greek retail prices are VAT-inclusive by law.
 */
export interface MarginMetrics {
  netSale: number;
  marginAmount: number;
  marginPercent: number;
}

export function computeMargin(
  salePriceVatInclusive: number,
  costPrice: number,
  vatRate: number
): MarginMetrics {
  const netSale = salePriceVatInclusive / (1 + vatRate);
  const marginAmount = netSale - costPrice;
  const marginPercent = netSale > 0 ? marginAmount / netSale : 0;
  return {
    netSale: round2(netSale),
    marginAmount: round2(marginAmount),
    marginPercent: round4(marginPercent),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Supabase infers an embedded `categories(...)` join as an array even when
 * the FK is 1:1 (it returns a single object at runtime). Normalise the join
 * shape into a flat list of category-rate rows ready for resolveEffectiveVatRate.
 *
 * Pass the array of rows from a query like:
 *   select("category_id, categories(id, vat_rate_id)")
 */
export function normaliseJoinedCategories(
  raw: unknown
): Array<{ id: string; vat_rate_id: string | null }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string; vat_rate_id: string | null }> = [];
  for (const r of raw as Array<{ categories: unknown }>) {
    pushJoinedCategory(r.categories, out);
  }
  return out;
}

/** Append a single (possibly array-wrapped) joined category onto `out`. */
export function pushJoinedCategory(
  value: unknown,
  out: Array<{ id: string; vat_rate_id: string | null }>
): void {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const x of value as Array<{ id: string; vat_rate_id: string | null }>) {
      if (x) out.push(x);
    }
  } else {
    out.push(value as { id: string; vat_rate_id: string | null });
  }
}
