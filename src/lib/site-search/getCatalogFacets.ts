import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveShowWhenOosForVariants } from "@/lib/storefront/resolveOosVisibility";
import { resolveEffectiveSplitters } from "@/lib/variants-helpers";
import { compareAttributeValues } from "@/lib/sort-attribute-values";
import { fail, ok, type Result } from "@/types/result";

export interface FacetValue {
  /**
   * For splitter facets (sourced from variant attribute_combo) this is the
   * attribute_value UUID — pass it back into searchVariants.attributeFilters
   * to filter. For spec facets (sourced from product_specifications) this
   * is the free-text spec value.
   */
  value: string;
  /** Display text rendered to the customer. */
  label: string;
  count: number;
}

export interface AttributeFacet {
  attributeSlug: string;
  attributeName: string;
  values: FacetValue[];
}

export interface CatalogFacets {
  facets: AttributeFacet[];
}

/**
 * Returns per-attribute value counts across the live catalog. Facets are
 * union-derived from TWO sources:
 *
 *   1. Variant attributes — values in product_variants.attribute_combo on
 *      attributes that are splitters EITHER globally
 *      (attributes.splits_listing=true) OR per-product (products.split_overrides
 *      has the slug set to true). The listing engine resolves these per-
 *      product via resolveEffectiveSplitters; the facet engine must use the
 *      same resolution or the two will disagree (chips missing for products
 *      whose splitting is enabled only by override, or chips appearing for
 *      products whose splitting is suppressed only by override).
 *   2. Product specifications — values in product_specifications rows.
 *      Customer-facing FACT.
 *
 * Counts are distinct-products per (attribute, value), so the count means
 * "how many products match this filter" — consistent regardless of whether
 * the match comes from a variant attribute or a spec.
 *
 * Used by the storefront FilterSidebar to render checkbox counts.
 */
async function getCatalogFacetsInner(
  categorySlug?: string
): Promise<Result<CatalogFacets>> {
  const supabase = createAdminClient();

  // 1-3: Three independent reads — attributes, spec attribute usage, and
  // active products. All run in parallel since none depends on the others.
  const [
    { data: allAttrsRaw },
    { data: specAttrRows },
    { data: productRows },
  ] = await Promise.all([
    supabase.from("attributes").select("id, slug, name, splits_listing"),
    supabase.from("product_specifications").select("attribute_id"),
    supabase.from("products").select("id, split_overrides, active").eq("active", true),
  ]);
  const allAttributes = (allAttrsRaw ?? []) as Array<{
    id: string;
    slug: string;
    name: string;
    splits_listing: boolean;
  }>;
  const specAttrIds = new Set(
    ((specAttrRows ?? []) as Array<{ attribute_id: string }>).map((r) => r.attribute_id)
  );
  type ProdRow = {
    id: string;
    split_overrides: Record<string, boolean> | null;
    active: boolean;
  };
  const products = (productRows ?? []) as ProdRow[];
  const splittersByProductId = new Map<string, Set<string>>();
  for (const p of products) {
    const slugs = resolveEffectiveSplitters(allAttributes, p.split_overrides);
    splittersByProductId.set(p.id, new Set(slugs));
  }

  // 4a. Hoist the visible-variants fetch BEFORE the facet-attribute union
  //     resolution. The OOS visibility gate ALREADY runs inside this
  //     fetch — only variants that are in stock OR have show_when_oos=true
  //     come out — so the variant combos we'll union over are exactly
  //     the "filterable" set the storefront would surface.
  //
  //     Architectural note: filter visibility is independent of listing-
  //     card splitting. A product that's configured to NOT split its
  //     listing by `size` (one card per shoe regardless of size) STILL
  //     needs `size` to be filterable in the sidebar — customers will
  //     ask "do you have a size 19?" and the sidebar must let them
  //     check it. So we feed the facet engine every attribute that
  //     appears in any visible variant's combo, not just slugs that are
  //     splitters somewhere. Splitting drives cards; combo membership
  //     drives filters.
  const splitterUnion = new Set<string>();
  for (const set of splittersByProductId.values()) {
    for (const slug of set) splitterUnion.add(slug);
  }
  const activeProductIds = new Set(products.map((p) => p.id));

  type InvSnap = {
    quantity_available: number;
    quantity_soft_held: number;
    quantity_priority_held: number;
  };
  type VarRow = {
    id: string;
    product_id: string;
    attribute_combo: Record<string, string> | null;
    inventory_items: InvSnap | InvSnap[] | null;
  };

  async function fetchVisibleVariants(): Promise<
    Array<{
      id: string;
      product_id: string;
      attribute_combo: Record<string, string> | null;
      stock: number;
    }>
  > {
    const { data, error } = await supabase
      .from("product_variants")
      .select(
        "id, product_id, attribute_combo, inventory_items(quantity_available, quantity_soft_held, quantity_priority_held)"
      )
      .eq("is_active", true);
    if (error) throw error;
    const rows = (data ?? []) as VarRow[];
    // Scope to active products on the JS side rather than via the join — the
    // join filter forces a different query shape in some PostgREST versions.
    const scoped = rows.filter((r) => activeProductIds.has(r.product_id));
    const ids = scoped.map((r) => r.id);
    const vis = await resolveShowWhenOosForVariants(supabase, ids);
    return scoped
      .map((r) => {
        const inv = Array.isArray(r.inventory_items)
          ? r.inventory_items[0]
          : r.inventory_items;
        // Contestable = still in play (available + soft + priority). Only
        // quantity_reserved is treated as gone.
        const contestable =
          Number(inv?.quantity_available ?? 0) +
          Number(inv?.quantity_soft_held ?? 0) +
          Number(inv?.quantity_priority_held ?? 0);
        return {
          id: r.id,
          product_id: r.product_id,
          attribute_combo: r.attribute_combo,
          stock: contestable,
        };
      })
      .filter((r) => r.stock > 0 || vis.get(r.id) === true);
  }

  let visibleVariants: Awaited<ReturnType<typeof fetchVisibleVariants>> = [];
  try {
    visibleVariants = await fetchVisibleVariants();
  } catch (e) {
    const err = e as { message?: string; code?: string };
    return fail<CatalogFacets>(err.message ?? "Variant query failed", err.code);
  }

  // Category scoping — when a categorySlug is given, restrict facet
  // computation to that category's member products so the visible filters
  // reflect only what's relevant to the chosen category. Manual categories
  // resolve via product_categories; auto categories match the visible
  // variants against their attribute_filters (OR within attr, AND across).
  let allowedProductIds: Set<string> | null = null;
  if (categorySlug) {
    const { data: catRow } = await supabase
      .from("categories")
      .select("id, mode, auto_rules")
      .eq("slug", categorySlug)
      .maybeSingle();
    const cat = catRow as
      | {
          id: string;
          mode: "manual" | "auto";
          auto_rules: { attribute_filters: Record<string, string[]> } | null;
        }
      | null;
    if (!cat) return ok({ facets: [] });
    if (cat.mode === "auto") {
      const entries = Object.entries(cat.auto_rules?.attribute_filters ?? {}).filter(
        ([, vs]) => vs.length > 0
      );
      allowedProductIds = new Set<string>();
      for (const v of visibleVariants) {
        const combo = v.attribute_combo ?? {};
        const matches = entries.every(([slug, vals]) => vals.includes(combo[slug] ?? ""));
        if (entries.length === 0 || matches) allowedProductIds.add(v.product_id);
      }
    } else {
      const { data: pcRows } = await supabase
        .from("product_categories")
        .select("product_id")
        .eq("category_id", cat.id);
      allowedProductIds = new Set(
        ((pcRows ?? []) as Array<{ product_id: string }>).map((r) => r.product_id)
      );
    }
  }

  // 4b. Collect every attribute slug used in any visible variant's combo.
  //     This is the "filterable from variants" set. Combined with the
  //     spec-source set and any splitter (defense in case an attribute is
  //     a splitter but currently has no visible variants), this is the
  //     full facet-attribute universe.
  const slugsUsedByVariants = new Set<string>();
  for (const v of visibleVariants) {
    if (!v.attribute_combo) continue;
    for (const slug of Object.keys(v.attribute_combo)) {
      slugsUsedByVariants.add(slug);
    }
  }

  const allFacetAttrs: Array<{ id: string; slug: string; name: string }> = [];
  const seen = new Set<string>();
  for (const a of allAttributes) {
    const isSplitterSomewhere = splitterUnion.has(a.slug);
    const isUsedByVariant = slugsUsedByVariants.has(a.slug);
    const isSpecSource = specAttrIds.has(a.id);
    if (!isSplitterSomewhere && !isUsedByVariant && !isSpecSource) continue;
    if (seen.has(a.slug)) continue;
    allFacetAttrs.push({ id: a.id, slug: a.slug, name: a.name });
    seen.add(a.slug);
  }
  if (allFacetAttrs.length === 0) {
    return ok({ facets: [] });
  }

  // 5. Build per-attribute distinct-product-id sets per value.
  //    Maps slug → value → Set<product_id>.
  //
  //    Sellability gate: a variant counts only if it's either in stock OR
  //    its resolved show_when_oos is true (already applied inside
  //    fetchVisibleVariants above).
  const productsByFacet = new Map<string, Map<string, Set<string>>>();
  for (const a of allFacetAttrs) productsByFacet.set(a.slug, new Map());

  // 5a. Every variant contributes to facets for EVERY attribute slug in
  //     its attribute_combo — not just the slugs that are splitters for
  //     its product. The splitter flag controls listing-card grouping;
  //     the filter sidebar deliberately ignores it so customers can
  //     still narrow by non-splitter attributes (e.g. shoe sizes when
  //     the product card doesn't split by size).
  for (const row of visibleVariants) {
    if (!row.attribute_combo) continue;
    if (allowedProductIds && !allowedProductIds.has(row.product_id)) continue;
    for (const [slug, valueId] of Object.entries(row.attribute_combo)) {
      if (typeof valueId !== "string") continue;
      const map = productsByFacet.get(slug);
      if (!map) continue; // attribute not registered as a facet (shouldn't happen)
      const set = map.get(valueId) ?? new Set<string>();
      set.add(row.product_id);
      map.set(valueId, set);
    }
  }

  // 5b. From product_specifications. Specs attach to PRODUCTS (not variants),
  //     so we need the set of products that have at least one visible
  //     variant (in stock OR resolved show_when_oos = true).
  if (specAttrIds.size > 0) {
    const sellableProductIds = new Set(
      visibleVariants
        .map((r) => r.product_id)
        .filter((id) => !allowedProductIds || allowedProductIds.has(id))
    );

    if (sellableProductIds.size > 0) {
      const { data: specs } = await supabase
        .from("product_specifications")
        .select("product_id, value, attributes!inner(slug)")
        .in("product_id", Array.from(sellableProductIds));
      type Row = {
        product_id: string;
        value: string;
        attributes: { slug: string } | { slug: string }[] | null;
      };
      for (const row of (specs ?? []) as Row[]) {
        const attr = Array.isArray(row.attributes) ? row.attributes[0] : row.attributes;
        if (!attr) continue;
        const map = productsByFacet.get(attr.slug);
        if (!map) continue;
        const set = map.get(row.value) ?? new Set<string>();
        set.add(row.product_id);
        map.set(row.value, set);
      }
    }
  }

  // 6. Resolve every UUID-shaped key (across ALL facet attributes) to
  //    display labels in one batch. UUID shape is the right gate — not
  //    "is the attribute a splitter" — because variant combos contribute
  //    UUID keys regardless of splitter status now. Spec values, which
  //    are free text, never match the UUID regex so they bypass the
  //    lookup naturally.
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const uuidValueIds = new Set<string>();
  for (const a of allFacetAttrs) {
    const map = productsByFacet.get(a.slug);
    if (!map) continue;
    for (const key of map.keys()) {
      if (UUID_RE.test(key)) uuidValueIds.add(key);
    }
  }
  const valueLabelById = new Map<string, string>();
  if (uuidValueIds.size > 0) {
    const { data: vRows } = await supabase
      .from("attribute_values")
      .select("id, value")
      .in("id", Array.from(uuidValueIds));
    for (const r of (vRows ?? []) as Array<{ id: string; value: string }>) {
      valueLabelById.set(r.id, r.value);
    }
  }

  // 7. Collapse to FacetValue[].
  //
  // Per-key label resolution: UUID-shaped keys MUST resolve via
  // valueLabelById; if they don't (orphan attribute_value referenced
  // by a stale combo), drop the value rather than leak the UUID. Non-
  // UUID keys are spec text values that pass through as-is.
  //
  // The delete-protection trigger (20260603000006) makes orphan UUIDs
  // unreachable under normal operation; this filter is the last line
  // in case a future code path bypasses that guard.
  const facets: AttributeFacet[] = allFacetAttrs.map((attr) => {
    const map = productsByFacet.get(attr.slug) ?? new Map();
    const values: FacetValue[] = Array.from(map.entries())
      .map(([key, productSet]) => {
        const isUuid = UUID_RE.test(key);
        const resolvedLabel = isUuid ? valueLabelById.get(key) : key;
        return {
          value: key,
          label: resolvedLabel,
          count: (productSet as Set<string>).size,
        };
      })
      .filter((v): v is FacetValue => {
        if (v.count === 0) return false;
        // Orphan UUID — drop instead of leaking. Logged so the bug
        // becomes admin-visible rather than customer-visible.
        if (v.label === undefined) {
          console.warn(
            `[catalog-facets] dropping orphan splitter value ${v.value} on attribute "${attr.slug}" (referenced by ${v.count} product(s) but no attribute_values row resolves)`
          );
          return false;
        }
        return true;
      })
      // Storefront facet sort: count-descending first (popularity), then
      // by the value's natural content order (numeric ascending for
      // sizes like "16/18/20", locale-alphabetical for strings). Uses
      // the same comparator the admin sees so the customer view doesn't
      // diverge.
      .sort((a, b) => {
        if (a.count !== b.count) return b.count - a.count;
        return compareAttributeValues(
          { value: a.label },
          { value: b.label }
        );
      });
    return {
      attributeSlug: attr.slug,
      attributeName: attr.name,
      values,
    };
  });

  // Drop facets with no values — when scoped to a category this naturally
  // hides attributes that don't apply, so the filters shown depend on the
  // selected category.
  return ok({ facets: facets.filter((f) => f.values.length > 0) });
}

/**
 * Cached version of getCatalogFacets. Facet counts change only when
 * products / inventory / variants / attributes / category assignments
 * are edited by admins, and every admin mutation now fires
 * updateTag("catalog-facets") (Phase 4 of the data-layer
 * remediation). The 24h `revalidate` is a redundant safety net —
 * effectively the cache only refreshes on tag bust.
 *
 * Previously was 300s (5min), which forced a recompute every 5 minutes
 * regardless of whether anything changed. Tag busting now covers every
 * surface that affects facet counts:
 *   - product create / update / delete
 *   - bulk product update / delete / set-active
 *   - variant add / update / delete / matrix expand / axis add / axis value add
 *   - inventory setLevel + bulk quantity/trackSupply
 *   - all attribute mutations (create/update/delete + values + bulk)
 *   - product spec add / update / remove
 *   - setProductCategories
 */
export const getCatalogFacets = unstable_cache(
  getCatalogFacetsInner,
  ["catalog-facets"],
  { revalidate: 86400, tags: ["catalog-facets"] }
);
