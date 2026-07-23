"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { slugifyValue } from "@/lib/variants-helpers";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  productId: z.string().uuid(),
  /** UUIDs of attribute_values that constitute the new axis. */
  attributeValueIds: z.array(z.string().uuid()).min(1),
  price: z.number().nonnegative().optional(),
  skuPrefix: z.string().min(1).max(80).optional(),
  /**
   * Optional explicit list of combos to create. When provided, the action
   * creates ONLY these (after deduping against existing variants). When
   * absent, falls back to the legacy fan-out (existing variants × every
   * new axis value).
   */
  targetShapes: z.array(z.record(z.string().uuid())).optional(),
});

/**
 * Adds a new attribute axis to a product. Every existing variant gets
 * replicated once per value on the new axis (Cartesian fan-out). When the
 * product currently has no variants, creates one variant per new value.
 *
 * The matrix-shape DB trigger enforces consistency — if the new axis would
 * conflict with existing variants of differing shapes, the insert fails.
 */
export async function addAxisToProduct(
  input: z.input<typeof Schema>
): Promise<Result<{ created: number }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ created: number }>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<{ created: number }>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();

  // Resolve the new axis's attribute slug from the first value (all values
  // must share an attribute since the form selects under one attribute row).
  const { data: avRows } = await supabase
    .from("attribute_values")
    .select("id, value, slug, attribute_id, attributes(slug)")
    .in("id", parsed.data.attributeValueIds);
  type AV = {
    id: string;
    value: string;
    slug: string;
    attribute_id: string;
    attributes: { slug: string } | { slug: string }[] | null;
  };
  const avs = (avRows ?? []) as AV[];
  if (avs.length !== parsed.data.attributeValueIds.length) {
    return fail<{ created: number }>("One or more attribute values missing", "NOT_FOUND");
  }
  const attrSlugs = new Set(
    avs
      .map((av) => (Array.isArray(av.attributes) ? av.attributes[0]?.slug : av.attributes?.slug))
      .filter(Boolean)
  );
  if (attrSlugs.size !== 1) {
    return fail<{ created: number }>(
      "All values must belong to the same attribute",
      "INVALID_INPUT"
    );
  }
  const axisSlug = avs[0].attributes
    ? (Array.isArray(avs[0].attributes) ? avs[0].attributes[0].slug : avs[0].attributes.slug)
    : "";

  const [{ data: productRow }, { data: existingVariants }] = await Promise.all([
    supabase
      .from("products")
      .select("id, slug, base_price, base_sku")
      .eq("id", parsed.data.productId)
      .maybeSingle(),
    supabase
      .from("product_variants")
      .select("id, attribute_combo")
      .eq("product_id", parsed.data.productId),
  ]);
  const product = productRow as
    | { id: string; slug: string; base_price: number | string; base_sku: string | null }
    | null;
  if (!product) return fail<{ created: number }>("Product not found", "NOT_FOUND");
  const variants = (existingVariants ?? []) as Array<{
    id: string;
    attribute_combo: Record<string, string> | null;
  }>;

  // Resolve value slugs for SKU generation.
  const allValueIds = new Set<string>(parsed.data.attributeValueIds);
  for (const v of variants) {
    if (!v.attribute_combo) continue;
    for (const id of Object.values(v.attribute_combo)) allValueIds.add(id);
  }
  const { data: vRows } = await supabase
    .from("attribute_values")
    .select("id, slug")
    .in("id", Array.from(allValueIds));
  const slugById = new Map(
    ((vRows ?? []) as Array<{ id: string; slug: string }>).map((r) => [r.id, r.slug])
  );

  const price = parsed.data.price ?? Number(product.base_price);
  // Prefer admin-chosen base SKU; fall back to slugified product slug.
  const skuPrefix =
    (parsed.data.skuPrefix ?? product.base_sku ?? slugifyValue(product.slug)) || product.id;

  // Pick combos to create. Picker UI passes parsed.data.targetShapes
  // (already filtered to the admin's selection); programmatic callers
  // get the legacy fan-out.
  type Shape = Record<string, string>;
  const canonKey = (s: Shape) =>
    JSON.stringify(
      Object.keys(s)
        .sort()
        .reduce<Shape>((acc, k) => {
          acc[k] = s[k];
          return acc;
        }, {})
    );
  const existingKeys = new Set<string>();
  for (const v of variants) {
    if (v.attribute_combo) existingKeys.add(canonKey(v.attribute_combo));
  }

  const seen = new Set<string>();
  const newCombos: Shape[] = [];
  if (parsed.data.targetShapes && parsed.data.targetShapes.length > 0) {
    for (const shape of parsed.data.targetShapes) {
      const key = canonKey(shape);
      if (seen.has(key) || existingKeys.has(key)) continue;
      seen.add(key);
      newCombos.push(shape);
    }
  } else if (variants.length === 0) {
    for (const valueId of parsed.data.attributeValueIds) {
      newCombos.push({ [axisSlug]: valueId });
    }
  } else {
    for (const v of variants) {
      const base = v.attribute_combo ?? {};
      for (const valueId of parsed.data.attributeValueIds) {
        const combo = { ...base, [axisSlug]: valueId };
        const key = canonKey(combo);
        if (seen.has(key) || existingKeys.has(key)) continue;
        seen.add(key);
        newCombos.push(combo);
      }
    }
  }

  // Single bulk insert instead of per-combo round-trips. Phase 9.
  const rows = newCombos.map((combo) => {
    const sortedSlugs = Object.keys(combo).sort();
    const suffix = sortedSlugs.map((k) => slugById.get(combo[k]) ?? "v").join("-");
    return {
      product_id: parsed.data.productId,
      sku: `${skuPrefix}-${suffix}`,
      price,
      attribute_combo: combo,
      is_active: true,
    };
  });

  let created = 0;
  if (rows.length > 0) {
    const { data: insertedRows, error } = await supabase
      .from("product_variants")
      .upsert(rows, { onConflict: "sku", ignoreDuplicates: true })
      .select("id");
    if (error && error.code !== "23505") {
      return fail<{ created: number }>(
        `Bulk insert failed: ${error.message}`,
        error.code
      );
    }
    created = (insertedRows ?? []).length;
  }

  // If the product already had variants and we're adding a new axis, the
  // existing variants are now matrix-shape-incompatible with the new ones.
  // The trigger will have blocked the inserts above unless we also delete
  // the old shapes. For V1 we expect the admin to call this only when the
  // product has no variants yet, OR to accept the trigger error.

  revalidatePath("/admin/products");
  // New axis values change storefront facet sets (a new color filter
  // becomes available) and product cards. Bust both.
  revalidatePath("/products");
  updateTag("catalog-facets");
  return ok({ created });
}
