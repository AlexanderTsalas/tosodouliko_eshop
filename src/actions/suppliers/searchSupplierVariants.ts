"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  supplierId: z.string().uuid(),
  q: z.string().max(200).optional(),
  /** Variant IDs to exclude (already on the draft). */
  excludeIds: z.array(z.string().uuid()).default([]),
  limit: z.number().int().positive().max(50).default(20),
});

export interface SupplierVariantResult {
  variant_id: string;
  product_name: string;
  variant_label: string | null;
  business_sku: string;
  supplier_sku: string | null;
  quantity_available: number;
  low_stock_threshold: number;
}

/**
 * Searches variants linked to a supplier via supplier_products. Used by the
 * "Add custom item" picker on the supplier's draft card, so admin can add
 * any item this supplier carries even if it's not low-stock.
 *
 * Returns up to `limit` results, matching SKU or product name. Excludes
 * variants already on the draft so the picker doesn't duplicate suggestions.
 */
export async function searchSupplierVariants(
  input: z.input<typeof Schema>
): Promise<Result<SupplierVariantResult[]>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<SupplierVariantResult[]>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:suppliers"))) {
    return fail<SupplierVariantResult[]>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();

  // Find all variant IDs linked to this supplier via supplier_products.
  const { data: spRows } = await supabase
    .from("supplier_products")
    .select("variant_id, supplier_sku")
    .eq("supplier_id", parsed.data.supplierId)
    .eq("active", true);

  type SpRow = { variant_id: string; supplier_sku: string | null };
  const links = (spRows ?? []) as SpRow[];
  if (links.length === 0) return ok([]);

  const supplierSkuByVariant = new Map<string, string | null>();
  for (const r of links) supplierSkuByVariant.set(r.variant_id, r.supplier_sku);

  const candidateIds = links
    .map((r) => r.variant_id)
    .filter((id) => !parsed.data.excludeIds.includes(id));
  if (candidateIds.length === 0) return ok([]);

  // Pull the matching variants with product + inventory joined.
  let vQuery = supabase
    .from("product_variants")
    .select(
      "id, sku, attribute_combo, products!inner(name), inventory_items(quantity_available, low_stock_threshold)"
    )
    .in("id", candidateIds)
    .eq("is_active", true)
    .limit(parsed.data.limit);

  if (parsed.data.q && parsed.data.q.trim()) {
    const term = `%${parsed.data.q.trim().replace(/[%_]/g, "\\$&")}%`;
    vQuery = vQuery.or(`sku.ilike.${term},products.name.ilike.${term}`);
  }

  const { data: vRows, error } = await vQuery;
  if (error) return fail<SupplierVariantResult[]>(error.message, error.code);

  type VRow = {
    id: string;
    sku: string;
    attribute_combo: Record<string, string> | null;
    products: { name: string } | { name: string }[] | null;
    inventory_items:
      | { quantity_available: number; low_stock_threshold: number }
      | { quantity_available: number; low_stock_threshold: number }[]
      | null;
  };

  const typedRows = (vRows ?? []) as VRow[];

  // Batch-resolve attribute_combo value UUIDs to display strings.
  const allValueIds = new Set<string>();
  for (const r of typedRows) {
    if (!r.attribute_combo) continue;
    for (const id of Object.values(r.attribute_combo)) allValueIds.add(id);
  }
  const valueLabelById = new Map<string, string>();
  if (allValueIds.size > 0) {
    const { data: avRows } = await supabase
      .from("attribute_values")
      .select("id, value")
      .in("id", Array.from(allValueIds));
    for (const r of (avRows ?? []) as Array<{ id: string; value: string }>) {
      valueLabelById.set(r.id, r.value);
    }
  }

  const results: SupplierVariantResult[] = typedRows.map((r) => {
    const product = Array.isArray(r.products) ? r.products[0] : r.products;
    const inv = Array.isArray(r.inventory_items) ? r.inventory_items[0] : r.inventory_items;
    let variantLabel: string | null = null;
    if (r.attribute_combo) {
      const labels = Object.values(r.attribute_combo)
        .map((id) => valueLabelById.get(id))
        .filter((s): s is string => typeof s === "string");
      if (labels.length > 0) variantLabel = labels.join(", ");
    }
    return {
      variant_id: r.id,
      product_name: product?.name ?? "(unknown)",
      variant_label: variantLabel,
      business_sku: r.sku,
      supplier_sku: supplierSkuByVariant.get(r.id) ?? null,
      quantity_available: inv?.quantity_available ?? 0,
      low_stock_threshold: inv?.low_stock_threshold ?? 0,
    };
  });

  return ok(results);
}
