import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Aggregated view of supplier configuration at the PRODUCT level.
 *
 * supplier_products lives per-variant, but the admin overview wants to
 * see "this product has Supplier X with SKU 'foo' at €5/unit" — one
 * row per supplier, not per (supplier × variant). This shape collapses
 * the per-variant rows for the same supplier into a single summary,
 * surfacing whether all variants share the same SKU / cost ("uniform")
 * or some differ ("mixed").
 *
 * When a supplier is "uniform", the overview UI shows the value
 * directly and edits it via setProductSupplier which fans the change
 * back out to every (variant, supplier) row. When "mixed", the
 * overview hides the value and directs the admin to the per-variant
 * panel.
 */
export interface ProductSupplierSummary {
  supplier_id: string;
  supplier_name: string;
  supplier_default_currency: string;
  /** True if EVERY variant's supplier_products row for this supplier is marked preferred. */
  is_preferred: boolean;
  /** How many variants of this product are linked to this supplier. */
  variant_count: number;
  /** Total variants on this product (for "X of Y variants" display). */
  total_variant_count: number;

  /** Shared supplier_sku across all variants, or null if mixed/empty. */
  default_supplier_sku: string | null;
  sku_is_mixed: boolean;

  /** Shared unit_cost across all variants, or null if mixed/empty. */
  default_unit_cost: number | null;
  default_unit_cost_currency: string | null;
  cost_is_mixed: boolean;
}

export async function getProductSupplierSummary(
  productId: string
): Promise<ProductSupplierSummary[]> {
  const supabase = await createClient();

  // 1. All variants of this product.
  const { data: variants } = await supabase
    .from("product_variants")
    .select("id")
    .eq("product_id", productId);
  const variantIds = ((variants ?? []) as Array<{ id: string }>).map((v) => v.id);
  const totalVariantCount = variantIds.length;
  if (variantIds.length === 0) return [];

  // 2. All supplier_products rows for those variants, joined with supplier metadata.
  const { data: rows } = await supabase
    .from("supplier_products")
    .select(
      "id, variant_id, supplier_id, supplier_sku, is_preferred, unit_cost, unit_cost_currency, suppliers!inner(id, name, default_currency)"
    )
    .in("variant_id", variantIds);

  type Row = {
    id: string;
    variant_id: string;
    supplier_id: string;
    supplier_sku: string | null;
    is_preferred: boolean;
    unit_cost: number | string | null;
    unit_cost_currency: string | null;
    suppliers: {
      id: string;
      name: string;
      default_currency: string;
    } | Array<{ id: string; name: string; default_currency: string }> | null;
  };

  // 3. Group by supplier_id and collapse.
  const bySupplier = new Map<string, Row[]>();
  for (const r of (rows ?? []) as Row[]) {
    const arr = bySupplier.get(r.supplier_id) ?? [];
    arr.push(r);
    bySupplier.set(r.supplier_id, arr);
  }

  const summaries: ProductSupplierSummary[] = [];
  for (const [supplierId, group] of bySupplier) {
    const first = group[0];
    const supplierObj = Array.isArray(first.suppliers)
      ? first.suppliers[0]
      : first.suppliers;
    if (!supplierObj) continue;

    // SKU: uniform iff every row has the same value (including null).
    const skuSet = new Set(group.map((g) => g.supplier_sku ?? ""));
    const skuIsMixed = skuSet.size > 1;
    const defaultSku = !skuIsMixed ? group[0].supplier_sku : null;

    // Cost: uniform iff every row has the same (cost, currency) pair.
    const costKey = (g: Row) =>
      `${g.unit_cost === null ? "" : Number(g.unit_cost).toFixed(2)}|${g.unit_cost_currency ?? ""}`;
    const costSet = new Set(group.map(costKey));
    const costIsMixed = costSet.size > 1;
    const defaultCost = !costIsMixed
      ? group[0].unit_cost === null
        ? null
        : Number(group[0].unit_cost)
      : null;
    const defaultCcy = !costIsMixed ? group[0].unit_cost_currency : null;

    // Preferred: only "preferred at the product level" if every variant
    // marks this supplier as preferred. A mixed state means the admin
    // hasn't decided uniformly; we report false to avoid claiming a
    // status that isn't true everywhere.
    const allPreferred = group.every((g) => g.is_preferred);

    summaries.push({
      supplier_id: supplierId,
      supplier_name: supplierObj.name,
      supplier_default_currency: supplierObj.default_currency,
      is_preferred: allPreferred,
      variant_count: group.length,
      total_variant_count: totalVariantCount,
      default_supplier_sku: defaultSku,
      sku_is_mixed: skuIsMixed,
      default_unit_cost: defaultCost,
      default_unit_cost_currency: defaultCcy,
      cost_is_mixed: costIsMixed,
    });
  }

  return summaries.sort((a, b) => a.supplier_name.localeCompare(b.supplier_name));
}
