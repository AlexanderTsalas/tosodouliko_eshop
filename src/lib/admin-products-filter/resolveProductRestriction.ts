import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminProductFilterParams } from "./productFilters";

/**
 * Returns the intersected product_id set from join-based filters
 * (category, supplier, attribute), with operator support:
 *   - "is"        → equals
 *   - "empty"     → product has no rows in the join
 *   - "not_empty" → product has any rows in the join
 *
 * Returns null when no join-based filter is active (don't restrict).
 * Returns an empty array when any filter has zero matches (short-circuit).
 *
 * Column-based filters (brand, price range, etc.) are handled by the
 * caller directly on the products query.
 */
export async function resolveProductRestriction(
  supabase: SupabaseClient,
  filters: AdminProductFilterParams
): Promise<string[] | null> {
  let restriction: Set<string> | null = null;

  function intersect(next: Set<string>) {
    if (restriction === null) {
      restriction = next;
    } else {
      const a = restriction;
      restriction = new Set<string>();
      for (const id of a) {
        if (next.has(id)) restriction.add(id);
      }
    }
  }

  // ---- Category filter ----
  const catOp = filters.categoryIdOp ?? (filters.categoryId ? "is" : undefined);
  if (catOp === "is" && filters.categoryId) {
    const { data } = await supabase
      .from("product_categories")
      .select("product_id")
      .eq("category_id", filters.categoryId);
    intersect(new Set(((data ?? []) as Array<{ product_id: string }>).map((r) => r.product_id)));
    if (restriction!.size === 0) return [];
  } else if (catOp === "empty") {
    const { data: hasCategory } = await supabase.from("product_categories").select("product_id");
    const withCategory = new Set(
      ((hasCategory ?? []) as Array<{ product_id: string }>).map((r) => r.product_id)
    );
    const { data: allProducts } = await supabase.from("products").select("id");
    const all = ((allProducts ?? []) as Array<{ id: string }>).map((r) => r.id);
    intersect(new Set(all.filter((id) => !withCategory.has(id))));
    if (restriction!.size === 0) return [];
  } else if (catOp === "not_empty") {
    const { data: hasCategory } = await supabase.from("product_categories").select("product_id");
    intersect(
      new Set(((hasCategory ?? []) as Array<{ product_id: string }>).map((r) => r.product_id))
    );
    if (restriction!.size === 0) return [];
  }

  // ---- Category set filter (column dropdown, multi-value "any of") ----
  // A product matches if it belongs to ANY of the selected categories.
  if (filters.categoryIds && filters.categoryIds.length > 0) {
    const { data } = await supabase
      .from("product_categories")
      .select("product_id")
      .in("category_id", filters.categoryIds);
    intersect(
      new Set(((data ?? []) as Array<{ product_id: string }>).map((r) => r.product_id))
    );
    if (restriction!.size === 0) return [];
  }

  // ---- Preferred-supplier set filter (column dropdown, multi-value) ----
  // Matches the "Προτιμώμενος" column semantics: the product has a variant
  // whose supplier_products row is is_preferred AND the supplier is one of
  // the selected ones.
  if (filters.supplierIds && filters.supplierIds.length > 0) {
    const { data: links } = await supabase
      .from("supplier_products")
      .select("product_variants!inner(product_id)")
      .eq("is_preferred", true)
      .in("supplier_id", filters.supplierIds);
    const set = new Set<string>();
    for (const r of (links ?? []) as Array<{
      product_variants: { product_id: string } | { product_id: string }[] | null;
    }>) {
      const pv = Array.isArray(r.product_variants) ? r.product_variants[0] : r.product_variants;
      if (pv?.product_id) set.add(pv.product_id);
    }
    intersect(set);
    if (restriction!.size === 0) return [];
  }

  // ---- Supplier filter ----
  // "is X"         → default_supplier_id = X OR any variant linked to X
  // "empty"        → no default AND no variant has any supplier_products link
  // "not_empty"    → default is set OR any variant has any supplier_products link
  const supOp = filters.supplierIdOp ?? (filters.supplierId ? "is" : undefined);
  if (supOp === "is" && filters.supplierId) {
    const [{ data: defaults }, { data: links }] = await Promise.all([
      supabase.from("products").select("id").eq("default_supplier_id", filters.supplierId),
      supabase
        .from("supplier_products")
        .select("product_variants!inner(product_id)")
        .eq("supplier_id", filters.supplierId),
    ]);
    const set = new Set<string>();
    for (const r of (defaults ?? []) as Array<{ id: string }>) set.add(r.id);
    for (const r of (links ?? []) as Array<{
      product_variants: { product_id: string } | { product_id: string }[] | null;
    }>) {
      const pv = Array.isArray(r.product_variants) ? r.product_variants[0] : r.product_variants;
      if (pv?.product_id) set.add(pv.product_id);
    }
    intersect(set);
    if (restriction!.size === 0) return [];
  } else if (supOp === "empty" || supOp === "not_empty") {
    const [{ data: defaults }, { data: links }] = await Promise.all([
      supabase.from("products").select("id").not("default_supplier_id", "is", null),
      supabase.from("supplier_products").select("product_variants!inner(product_id)"),
    ]);
    const withSupplier = new Set<string>();
    for (const r of (defaults ?? []) as Array<{ id: string }>) withSupplier.add(r.id);
    for (const r of (links ?? []) as Array<{
      product_variants: { product_id: string } | { product_id: string }[] | null;
    }>) {
      const pv = Array.isArray(r.product_variants) ? r.product_variants[0] : r.product_variants;
      if (pv?.product_id) withSupplier.add(pv.product_id);
    }
    if (supOp === "not_empty") {
      intersect(withSupplier);
    } else {
      const { data: allProducts } = await supabase.from("products").select("id");
      const all = ((allProducts ?? []) as Array<{ id: string }>).map((r) => r.id);
      intersect(new Set(all.filter((id) => !withSupplier.has(id))));
    }
    if (restriction!.size === 0) return [];
  }

  // ---- Attribute filters ----
  // Values are attribute_value UUIDs (matched directly against variants'
  // attribute_combo). For specs (free text), translate the UUIDs to display
  // text via attribute_values.
  if (filters.attributeFilters) {
    for (const [slug, valueIds] of Object.entries(filters.attributeFilters)) {
      if (valueIds.length === 0) continue;

      const { data: attrRow } = await supabase
        .from("attributes")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (!attrRow) return [];
      const attributeId = (attrRow as { id: string }).id;

      const { data: avRows } = await supabase
        .from("attribute_values")
        .select("id, value")
        .in("id", valueIds);
      const valueTexts = ((avRows ?? []) as Array<{ id: string; value: string }>).map(
        (r) => r.value
      );

      const { data: specRows } = valueTexts.length === 0
        ? { data: [] }
        : await supabase
            .from("product_specifications")
            .select("product_id")
            .eq("attribute_id", attributeId)
            .in("value", valueTexts);
      const specMatchIds = new Set(
        ((specRows ?? []) as Array<{ product_id: string }>).map((r) => r.product_id)
      );

      let variantQuery = supabase
        .from("product_variants")
        .select("product_id")
        .eq("is_active", true);
      const orParts = valueIds
        .map((id) => `attribute_combo.cs.${JSON.stringify({ [slug]: id })}`)
        .join(",");
      variantQuery = variantQuery.or(orParts);
      const { data: variantRows } = await variantQuery;
      const variantMatchIds = new Set(
        ((variantRows ?? []) as Array<{ product_id: string }>).map((r) => r.product_id)
      );

      const matchedThisAttr = new Set<string>([...specMatchIds, ...variantMatchIds]);
      intersect(matchedThisAttr);
      if (restriction!.size === 0) return [];
    }
  }

  return restriction === null ? null : Array.from(restriction);
}
