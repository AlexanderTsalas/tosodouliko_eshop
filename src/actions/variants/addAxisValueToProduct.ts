"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { slugifyValue } from "@/lib/variants-helpers";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  productId: z.string().uuid(),
  /** The new attribute_value_id to add as a value on the named axis. */
  attributeValueId: z.string().uuid(),
  /** Optional price for the newly created variants — defaults to the product base_price. */
  price: z.number().nonnegative().optional(),
  /**
   * Optional SKU prefix. Defaults to the parent product's slug. The final
   * variant SKU is `${prefix}-${slugifiedValuesOfNewCombo}`.
   */
  skuPrefix: z.string().min(1).max(80).optional(),
  /**
   * Optional explicit list of combos to create. When provided, the action
   * creates ONLY these (after deduping against existing variants). When
   * absent, falls back to the legacy fan-out behavior (one new combo per
   * existing sibling shape with the new value swapped in). The picker UI
   * uses this to honor the admin's per-row skip choices; programmatic
   * callers can omit it for the default "create everything" path.
   */
  targetShapes: z.array(z.record(z.string().uuid())).optional(),
});

/**
 * Extends an existing product's matrix with one new value on an existing axis.
 * For every existing variant of the product, generates a sibling variant that
 * replaces the targeted axis's value with the new one, leaving the other axes
 * untouched. Pre-existing siblings are skipped via the unique index on
 * (product_id, attribute_combo::text).
 *
 * When the product currently has no variants on this axis, this action falls
 * back to creating exactly one variant carrying just the new value — useful
 * when the axis itself is being introduced via this entry point.
 */
export async function addAxisValueToProduct(
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

  // Resolve the attribute_value (need its attribute slug + display text).
  const { data: avRow } = await supabase
    .from("attribute_values")
    .select("id, value, slug, attribute_id, attributes(slug)")
    .eq("id", parsed.data.attributeValueId)
    .maybeSingle();
  const av = avRow as
    | {
        id: string;
        value: string;
        slug: string;
        attribute_id: string;
        attributes: { slug: string } | { slug: string }[] | null;
      }
    | null;
  if (!av) return fail<{ created: number }>("Attribute value not found", "NOT_FOUND");
  const attr = Array.isArray(av.attributes) ? av.attributes[0] : av.attributes;
  if (!attr) return fail<{ created: number }>("Attribute not found", "NOT_FOUND");
  const axisSlug = attr.slug;

  // Resolve product + existing variants.
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

  // Resolve the full set of attribute_values referenced by existing combos —
  // needed to derive SKU suffixes from value slugs.
  const valueIdsInUse = new Set<string>([parsed.data.attributeValueId]);
  for (const v of variants) {
    if (!v.attribute_combo) continue;
    for (const id of Object.values(v.attribute_combo)) valueIdsInUse.add(id);
  }
  const { data: vRows } = await supabase
    .from("attribute_values")
    .select("id, slug")
    .in("id", Array.from(valueIdsInUse));
  const slugById = new Map(
    ((vRows ?? []) as Array<{ id: string; slug: string }>).map((r) => [r.id, r.slug])
  );

  const price = parsed.data.price ?? Number(product.base_price);
  // Prefer admin-chosen base SKU; fall back to slugified product slug.
  const skuPrefix =
    (parsed.data.skuPrefix ?? product.base_sku ?? slugifyValue(product.slug)) || product.id;

  // Determine which shapes to create. Two paths:
  //   1. Explicit picker-driven: caller provides parsed.data.targetShapes
  //      with the exact combos the admin opted in to. We trust the list
  //      but still dedupe against any existing variants (the unique index
  //      would catch dups anyway, but this saves the round-trip noise).
  //   2. Legacy fan-out: replicate every existing sibling shape with the
  //      new value swapped in. Used when no targetShapes is passed —
  //      programmatic callers and back-compat.
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

  const seenShapes = new Set<string>();
  const targetShapes: Shape[] = [];

  if (parsed.data.targetShapes && parsed.data.targetShapes.length > 0) {
    for (const shape of parsed.data.targetShapes) {
      const key = canonKey(shape);
      if (seenShapes.has(key) || existingKeys.has(key)) continue;
      seenShapes.add(key);
      targetShapes.push(shape);
    }
  } else if (variants.length === 0) {
    targetShapes.push({ [axisSlug]: parsed.data.attributeValueId });
  } else {
    for (const v of variants) {
      const combo = { ...(v.attribute_combo ?? {}) };
      combo[axisSlug] = parsed.data.attributeValueId;
      const key = canonKey(combo);
      if (seenShapes.has(key) || existingKeys.has(key)) continue;
      seenShapes.add(key);
      targetShapes.push(combo);
    }
  }

  // Single bulk insert instead of per-combo round-trips. Phase 9 of
  // the data-layer remediation — for a 4-axis matrix (32+ combos)
  // this is 32 round-trips → 1. ignoreDuplicates lets us silently
  // skip sibling shapes that already exist; the count of created
  // rows comes from the returned .data length.
  const rows = targetShapes.map((combo) => {
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

  revalidatePath("/admin/products");
  revalidatePath("/products");
  updateTag("catalog-facets");
  return ok({ created });
}
