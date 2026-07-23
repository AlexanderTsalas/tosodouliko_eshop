import { createClient } from "@/lib/supabase/server";
import { MAX_BULK_OPERATION } from "@/lib/bulk-selection/selectionUrl";
import { stockStatus } from "@/types/inventory-sync";

export interface InventoryFilterParams {
  q?: string;
  status?: string; // "ok" | "low" | "out"
  categoryId?: string;
  supplierId?: string;
  trackSupply?: string; // "yes" | "no"
}

/**
 * Resolves an inventory bulk-selection input into a concrete list of
 * variant IDs. Mirrors `resolveProductIds` but operates on the
 * inventory_items × product_variants × products join.
 *
 * Returns variant_ids (not inventory_items.id) since the actions work on
 * variants — setInventoryLevel, updateVariant.track_supply, etc.
 */
export async function resolveVariantInventoryIds(input: {
  ids: string[] | null;
  matchAll: boolean;
  filterParams?: InventoryFilterParams;
}): Promise<
  | { ok: true; variantIds: string[] }
  | { ok: false; error: string; code: string }
> {
  if (!input.matchAll) {
    if (!input.ids || input.ids.length === 0) {
      return { ok: false, error: "No selection provided", code: "EMPTY_SELECTION" };
    }
    if (input.ids.length > MAX_BULK_OPERATION) {
      return {
        ok: false,
        error: `Selection too large (max ${MAX_BULK_OPERATION}).`,
        code: "OVER_CAP",
      };
    }
    return { ok: true, variantIds: input.ids };
  }

  const supabase = await createClient();
  const f = input.filterParams ?? {};

  // Optional category/supplier narrowing (operates on the parent product set).
  let productIdRestriction: string[] | null = null;
  if (f.categoryId) {
    const { data: pcRows } = await supabase
      .from("product_categories")
      .select("product_id")
      .eq("category_id", f.categoryId);
    productIdRestriction = ((pcRows ?? []) as Array<{ product_id: string }>).map(
      (r) => r.product_id
    );
    if (productIdRestriction.length === 0) return { ok: true, variantIds: [] };
  }
  if (f.supplierId) {
    const [{ data: defaults }, { data: links }] = await Promise.all([
      supabase.from("products").select("id").eq("default_supplier_id", f.supplierId),
      supabase
        .from("supplier_products")
        .select("product_variants!inner(product_id)")
        .eq("supplier_id", f.supplierId),
    ]);
    const set = new Set<string>();
    for (const r of (defaults ?? []) as Array<{ id: string }>) set.add(r.id);
    for (const r of (links ?? []) as Array<{
      product_variants: { product_id: string } | { product_id: string }[] | null;
    }>) {
      const pv = Array.isArray(r.product_variants) ? r.product_variants[0] : r.product_variants;
      if (pv?.product_id) set.add(pv.product_id);
    }
    const list = Array.from(set);
    if (productIdRestriction) {
      const cat = new Set(productIdRestriction);
      productIdRestriction = list.filter((id) => cat.has(id));
    } else {
      productIdRestriction = list;
    }
    if (productIdRestriction.length === 0) return { ok: true, variantIds: [] };
  }

  let query = supabase
    .from("inventory_items")
    .select(
      "variant_id, quantity_available, low_stock_threshold, " +
        "product_variants!inner(sku, track_supply, is_active, products!inner(id, active))"
    )
    .limit(MAX_BULK_OPERATION + 1);

  if (f.q && f.q.trim()) {
    const term = `%${f.q.trim().replace(/[%_]/g, "\\$&")}%`;
    query = query.or(`sku.ilike.${term}`, { foreignTable: "product_variants" });
  }
  if (f.trackSupply === "yes") {
    query = query.eq("product_variants.track_supply", true);
  } else if (f.trackSupply === "no") {
    query = query.eq("product_variants.track_supply", false);
  }

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message, code: error.code ?? "QUERY_FAILED" };

  type Row = {
    variant_id: string;
    quantity_available: number;
    low_stock_threshold: number;
    product_variants:
      | {
          sku: string;
          track_supply: boolean;
          is_active: boolean;
          products: { id: string; active: boolean } | { id: string; active: boolean }[] | null;
        }
      | {
          sku: string;
          track_supply: boolean;
          is_active: boolean;
          products: { id: string; active: boolean } | { id: string; active: boolean }[] | null;
        }[];
  };

  let rows = ((data ?? []) as unknown) as Row[];

  // Active-product gate + product-id restriction.
  rows = rows.filter((r) => {
    const pv = Array.isArray(r.product_variants) ? r.product_variants[0] : r.product_variants;
    if (!pv?.is_active) return false;
    const product = Array.isArray(pv.products) ? pv.products[0] : pv.products;
    if (!product?.active) return false;
    if (productIdRestriction && !productIdRestriction.includes(product.id)) return false;
    return true;
  });

  // Status filter is computed per-row in JS (the threshold is per-row data).
  if (f.status === "out" || f.status === "low" || f.status === "ok") {
    rows = rows.filter(
      (r) =>
        stockStatus({
          quantity_available: r.quantity_available,
          low_stock_threshold: r.low_stock_threshold,
        }) === f.status
    );
  }

  if (rows.length > MAX_BULK_OPERATION) {
    return {
      ok: false,
      error: `Filter matches more than ${MAX_BULK_OPERATION} variants. Narrow your filters.`,
      code: "OVER_CAP",
    };
  }

  return { ok: true, variantIds: rows.map((r) => r.variant_id) };
}
