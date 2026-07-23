"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { slugifyValue } from "@/lib/variants-helpers";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  productId: z.string().uuid(),
  /**
   * The combos to create. Each is a flat map of attribute_slug →
   * attribute_value_id (uuid). The DB trigger validate_attribute_combo
   * enforces that every uuid points at a real attribute_values row
   * under the matching attribute, so callers don't have to.
   */
  combos: z.array(z.record(z.string().uuid())).min(1).max(500),
  /**
   * Optional per-combo price overrides, keyed by canonical comboKey
   * (the same canonicalization VariantComboPicker uses). When a key is
   * absent, the variant is created at the product's base_price.
   */
  pricePerCombo: z.record(z.number().nonnegative()).optional(),
  /**
   * Optional SKU prefix. Defaults to the product's base_sku, then
   * slugified product slug, then product id.
   */
  skuPrefix: z.string().min(1).max(80).optional(),
});

interface CreateResult {
  created: number;
  skipped: number;
}

/**
 * Bulk variant creation from a list of explicit combos. This is the
 * single primitive every "create variants" UI flow funnels into:
 *
 *   - ProductCreateForm initial save (combos = cartesian of staged pairs,
 *     minus user-skipped)
 *   - AxesEditor "+ Add value" (combos = existing siblings × each new value)
 *   - AxesEditor "+ Add new axis" (combos = existing variants × new values)
 *   - AxesEditor "fill matrix gaps" (combos = cartesian of current values
 *     minus existing variants, then user-picked subset)
 *
 * Behavior:
 *   - Duplicates are deduped against existing variants AND within the
 *     submitted batch. The unique index on (product_id, attribute_combo)
 *     would catch dups anyway, but skipping client-side keeps the
 *     `created` count honest and avoids 23505 noise.
 *   - SKU is derived from each combo's value slugs (alpha-sorted by
 *     attribute slug). Same scheme as addAxisValueToProduct so existing
 *     SKU patterns are preserved across all entry points.
 *   - Per-combo price overrides take precedence over the product
 *     base_price; combos without an override use base_price.
 *   - Any insert failure other than 23505 short-circuits with the SQL
 *     error so the admin sees actionable feedback (e.g. trigger
 *     validation failure on a forged combo).
 */
export async function addMatrixCombos(
  input: z.input<typeof Schema>
): Promise<Result<CreateResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<CreateResult>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<CreateResult>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();

  // Resolve product (for base_price + base_sku + slug fallback) and
  // existing variants (for dedup) in parallel.
  const [{ data: productRow }, { data: existingVariants }] = await Promise.all([
    supabase
      .from("products")
      .select("id, slug, base_price, base_sku, default_supplier_id")
      .eq("id", parsed.data.productId)
      .maybeSingle(),
    supabase
      .from("product_variants")
      .select("id, attribute_combo")
      .eq("product_id", parsed.data.productId),
  ]);
  const product = productRow as
    | {
        id: string;
        slug: string;
        base_price: number | string;
        base_sku: string | null;
        default_supplier_id: string | null;
      }
    | null;
  if (!product) return fail<CreateResult>("Product not found", "NOT_FOUND");

  const variants = (existingVariants ?? []) as Array<{
    id: string;
    attribute_combo: Record<string, string> | null;
  }>;

  // Build canonical-key set for dedup. The DB index canonicalizes via
  // jsonb_text comparison, but we need the same shape on the client
  // side to filter; comboKey()'s alpha-sorted slug join matches.
  type Shape = Record<string, string>;
  const canonKey = (s: Shape): string =>
    Object.keys(s)
      .sort()
      .map((k) => `${k}=${s[k]}`)
      .join("|");

  const existingKeys = new Set<string>();
  for (const v of variants) {
    if (v.attribute_combo) existingKeys.add(canonKey(v.attribute_combo));
  }

  // Filter submitted combos: dedupe against existing AND within batch.
  const seenInBatch = new Set<string>();
  const dedupedCombos: Shape[] = [];
  let skippedDueToExisting = 0;
  for (const combo of parsed.data.combos) {
    const key = canonKey(combo);
    if (existingKeys.has(key)) {
      skippedDueToExisting++;
      continue;
    }
    if (seenInBatch.has(key)) continue;
    seenInBatch.add(key);
    dedupedCombos.push(combo);
  }

  if (dedupedCombos.length === 0) {
    return ok({ created: 0, skipped: skippedDueToExisting });
  }

  // Propagation template — capture supplier_products links from the
  // existing variants so we can replicate them onto every NEW variant
  // we're about to create. Without this, the supplier link set up at
  // create time (defaultSupplierId + initialUnitCost from ProductForm)
  // would vanish on axis expansion: the placeholder variant gets
  // deleted by the cleanup at the end of this function, and its
  // cascade-delete on supplier_products would orphan all the data.
  //
  // Dedup strategy: by supplier_id. If two existing variants have the
  // same supplier with different costs (per-variant negotiation), the
  // first one's cost wins for new variants — admin can override per
  // variant from the Suppliers section. is_preferred is preserved
  // (with at-most-one-preferred-per-variant enforced by the unique
  // index on supplier_products).
  const existingVariantIds = variants.map((v) => v.id);
  type SupplierLinkTemplate = {
    supplier_id: string;
    supplier_sku: string | null;
    lead_time_days: number | null;
    is_preferred: boolean;
    unit_cost: number | null;
    unit_cost_currency: string | null;
  };
  const supplierLinkTemplates: SupplierLinkTemplate[] = [];
  if (existingVariantIds.length > 0) {
    const { data: existingLinks } = await supabase
      .from("supplier_products")
      .select(
        "supplier_id, supplier_sku, lead_time_days, is_preferred, unit_cost, unit_cost_currency"
      )
      .in("variant_id", existingVariantIds);
    const seenSuppliers = new Set<string>();
    for (const link of (existingLinks ?? []) as SupplierLinkTemplate[]) {
      if (seenSuppliers.has(link.supplier_id)) continue;
      seenSuppliers.add(link.supplier_id);
      supplierLinkTemplates.push(link);
    }
  }

  // No sibling template (the product's FIRST variants) — seed the preferred
  // supplier from the product-level default_supplier_id. This is what makes
  // a supplier picked in the overview (pre-variant) "resolve" onto the
  // variants the moment they're created, mirroring how base_price seeds each
  // variant's price. default_supplier_id is pure STAGING: once consumed onto
  // a real variant link, it's cleared (below) so it never lingers as a
  // second source of truth.
  let seededFromDefault = false;
  if (supplierLinkTemplates.length === 0 && product.default_supplier_id) {
    supplierLinkTemplates.push({
      supplier_id: product.default_supplier_id,
      supplier_sku: null,
      lead_time_days: null,
      is_preferred: true,
      unit_cost: null,
      unit_cost_currency: null,
    });
    seededFromDefault = true;
  }

  // Resolve attribute_value slugs for SKU generation. Gather every
  // value_id referenced across all combos plus all existing variants
  // (the latter so future inserts on the same product use the same slug
  // catalog without per-combo round-trips).
  const allValueIds = new Set<string>();
  for (const combo of dedupedCombos) {
    for (const id of Object.values(combo)) allValueIds.add(id);
  }
  const { data: vRows } = await supabase
    .from("attribute_values")
    .select("id, slug")
    .in("id", Array.from(allValueIds));
  const slugById = new Map(
    ((vRows ?? []) as Array<{ id: string; slug: string }>).map((r) => [r.id, r.slug])
  );

  const basePrice = Number(product.base_price);
  const skuPrefix =
    (parsed.data.skuPrefix ?? product.base_sku ?? slugifyValue(product.slug)) ||
    product.id;

  let created = 0;
  let skippedDueToConflict = 0;
  for (const combo of dedupedCombos) {
    const sortedSlugs = Object.keys(combo).sort();
    const suffix = sortedSlugs.map((k) => slugById.get(combo[k]) ?? "v").join("-");
    const finalSku = suffix ? `${skuPrefix}-${suffix}` : skuPrefix;

    const price = parsed.data.pricePerCombo?.[canonKey(combo)] ?? basePrice;

    // .select('id').single() captures the new variant's id so we can
    // create matching supplier_products links below. Without this we'd
    // need a follow-up SELECT to recover the id.
    const { data: insertedVariant, error } = await supabase
      .from("product_variants")
      .insert({
        product_id: parsed.data.productId,
        sku: finalSku,
        price,
        attribute_combo: combo,
        is_active: true,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") {
        // Lost race with another writer — fine, count as skipped.
        skippedDueToConflict++;
        continue;
      }
      return fail<CreateResult>(
        `Insert failed at ${finalSku}: ${error.message}`,
        error.code
      );
    }
    created++;

    // Replicate supplier_products links from the template captured
    // before the loop. Non-fatal — if propagation fails, the variant
    // is still created (admin can link manually).
    const newVariantId = (insertedVariant as { id: string }).id;
    if (supplierLinkTemplates.length > 0) {
      await supabase.from("supplier_products").insert(
        supplierLinkTemplates.map((t) => ({
          variant_id: newVariantId,
          supplier_id: t.supplier_id,
          supplier_sku: t.supplier_sku,
          lead_time_days: t.lead_time_days,
          is_preferred: t.is_preferred,
          unit_cost: t.unit_cost,
          unit_cost_currency: t.unit_cost_currency,
        }))
      );
    }
  }

  // Cleanup orphaned default variant(s) — historically, ProductForm
  // (mode="create") wrote ONE placeholder variant with
  // attribute_combo = NULL for every new product. The current form
  // no longer auto-generates this placeholder: admins now explicitly
  // describe variants at create time (either a single-SKU product
  // OR multi-axis combos). This cleanup remains for BACK-COMPAT —
  // it handles products that were created before the requirement
  // change AND any explicit single-SKU products that the admin later
  // expands into axes (the original single variant with
  // attribute_combo=NULL becomes the phantom when the first axis-
  // bearing combos land).
  //
  // Safe to delete this block once you're confident no
  // attribute_combo=NULL variants exist that need converting.
  //
  // Guards:
  //   - Only fires when we ACTUALLY inserted new combos this call.
  //   - Only deletes variants whose attribute_combo is null — never
  //     touches existing real variants.
  //   - Best-effort: if delete fails, we still return success with
  //     the created count (the trigger/RLS would surface the cause).
  //
  // Also: the schema/model assumes a product has EITHER axis-bearing
  // variants OR a single axis-less variant — never both. Deleting
  // the orphan here keeps that invariant.
  if (created > 0) {
    const nullComboVariantIds = variants
      .filter((v) => v.attribute_combo === null)
      .map((v) => v.id);
    if (nullComboVariantIds.length > 0) {
      await supabase
        .from("product_variants")
        .delete()
        .in("id", nullComboVariantIds);
    }

    // Clear the staging supplier now that it's been materialised onto real
    // per-variant links — keeps default_supplier_id transient (present only
    // pre-variant) rather than a lingering second source of truth.
    if (seededFromDefault) {
      await supabase
        .from("products")
        .update({ default_supplier_id: null })
        .eq("id", product.id);
    }
  }

  revalidatePath("/admin/products");
  revalidatePath("/products");
  updateTag("catalog-facets");
  return ok({
    created,
    skipped: skippedDueToExisting + skippedDueToConflict,
  });
}
