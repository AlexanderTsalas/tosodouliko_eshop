"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  q: z.string().max(200).optional(),
  excludeIds: z.array(z.string().uuid()).default([]),
  limit: z.number().int().positive().max(50).default(20),
});

export interface AdminVariantResult {
  variant_id: string;
  product_id: string;
  product_name: string;
  variant_label: string | null;
  sku: string;
  price: number;
  quantity_available: number;
  low_stock_threshold: number;
}

/**
 * Catalog-wide variant search for the admin "New Order" picker. Matches the
 * query against either the variant SKU or the product name and returns the
 * union, snapshotting `price` and inventory at read time.
 *
 * Implementation note: we deliberately split the SKU-match and product-name-
 * match into two separate queries instead of an `.or()` with an embedded-
 * resource filter (`products.name.ilike...`). PostgREST does technically
 * support that via the dotted syntax, but supabase-js doesn't route mixed
 * top-level + embedded filters through `.or()` reliably — the embedded clause
 * silently drops, returning zero rows. Two queries is cheap and bulletproof.
 */
export async function searchAdminVariants(
  input: z.input<typeof Schema>
): Promise<Result<AdminVariantResult[]>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<AdminVariantResult[]>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:orders"))) {
    return fail<AdminVariantResult[]>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const limit = parsed.data.limit;
  const excludeSet = new Set(parsed.data.excludeIds);
  const trimmed = parsed.data.q?.trim();
  const term = trimmed ? `%${trimmed.replace(/[%_]/g, "\\$&")}%` : null;

  // Build the base select once — used by every variant fetch.
  const VARIANT_SELECT =
    "id, product_id, sku, attribute_combo, price, products(name), inventory_items(quantity_available, low_stock_threshold)";

  type VariantRow = {
    id: string;
    product_id: string;
    sku: string;
    attribute_combo: Record<string, string> | null;
    price: number;
    products: { name: string } | { name: string }[] | null;
    inventory_items:
      | { quantity_available: number; low_stock_threshold: number }
      | { quantity_available: number; low_stock_threshold: number }[]
      | null;
  };

  let rows: VariantRow[] = [];

  if (!term) {
    // No search term — first `limit` active variants by SKU.
    const { data, error } = await supabase
      .from("product_variants")
      .select(VARIANT_SELECT)
      .eq("is_active", true)
      .order("sku", { ascending: true })
      .limit(limit + excludeSet.size);
    if (error) return fail<AdminVariantResult[]>(error.message, error.code);
    rows = (data ?? []) as VariantRow[];
  } else {
    // SKU-match path AND product-name-match path in parallel.
    const [skuRes, productRes] = await Promise.all([
      supabase
        .from("product_variants")
        .select(VARIANT_SELECT)
        .eq("is_active", true)
        .ilike("sku", term)
        .order("sku", { ascending: true })
        .limit(limit),
      supabase
        .from("products")
        .select("id")
        .ilike("name", term)
        .limit(limit),
    ]);
    if (skuRes.error) return fail<AdminVariantResult[]>(skuRes.error.message, skuRes.error.code);
    if (productRes.error)
      return fail<AdminVariantResult[]>(productRes.error.message, productRes.error.code);

    const productIds = (productRes.data ?? []).map((p) => (p as { id: string }).id);

    let nameMatched: VariantRow[] = [];
    if (productIds.length > 0) {
      const { data, error } = await supabase
        .from("product_variants")
        .select(VARIANT_SELECT)
        .eq("is_active", true)
        .in("product_id", productIds)
        .order("sku", { ascending: true })
        .limit(limit);
      if (error) return fail<AdminVariantResult[]>(error.message, error.code);
      nameMatched = (data ?? []) as VariantRow[];
    }

    // Merge + dedupe by variant id, preserving SKU-match priority.
    const seen = new Set<string>();
    const merged: VariantRow[] = [];
    for (const r of (skuRes.data ?? []) as VariantRow[]) {
      if (!seen.has(r.id)) {
        merged.push(r);
        seen.add(r.id);
      }
    }
    for (const r of nameMatched) {
      if (!seen.has(r.id)) {
        merged.push(r);
        seen.add(r.id);
      }
    }
    rows = merged;
  }

  const finalRows = rows.filter((r) => !excludeSet.has(r.id)).slice(0, limit);

  // Batch-resolve attribute_combo value UUIDs to display strings.
  const allValueIds = new Set<string>();
  for (const r of finalRows) {
    if (!r.attribute_combo) continue;
    for (const id of Object.values(r.attribute_combo)) allValueIds.add(id);
  }
  const valueLabelById = new Map<string, string>();
  if (allValueIds.size > 0) {
    const { data: vRows } = await supabase
      .from("attribute_values")
      .select("id, value")
      .in("id", Array.from(allValueIds));
    for (const r of (vRows ?? []) as Array<{ id: string; value: string }>) {
      valueLabelById.set(r.id, r.value);
    }
  }

  const results: AdminVariantResult[] = finalRows.map((r) => {
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
      product_id: r.product_id,
      product_name: product?.name ?? "(unknown)",
      variant_label: variantLabel,
      sku: r.sku,
      price: Number(r.price),
      quantity_available: inv?.quantity_available ?? 0,
      low_stock_threshold: inv?.low_stock_threshold ?? 0,
    };
  });

  return ok(results);
}
