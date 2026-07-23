"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import type {
  RelatedProductsAssociation,
  RelatedProductsFilterGroup,
  RelatedProductsFilterCondition,
  RelatedProductsManualPick,
  RelatedProductsAssociationFull,
  RelatedProductsFilterGroupWithConditions,
} from "@/types/related-products";
import type {
  ResolverDataset,
  ResolverProductData,
} from "./types";

/**
 * Loads everything the resolver needs in a single bundle of parallel
 * queries:
 *
 *   - All active associations + their groups + conditions + manual picks
 *   - All active products with their direct category ids
 *   - The full category tree (so we can pre-expand product category_ids
 *     with all ancestors — Phase 9e detail: include_descendants on a
 *     source condition is implicit because the viewer's category_ids
 *     already contain ancestors)
 *   - All active variants with their attribute_combo + inventory
 *
 * This is the only async work the engine does. The pure resolver function
 * operates on the returned bundle synchronously.
 */
export async function loadResolverData(): Promise<ResolverDataset> {
  const admin = createAdminClient();

  const [
    associationsRes,
    groupsRes,
    conditionsRes,
    picksRes,
    productsRes,
    productCategoriesRes,
    categoriesRes,
    variantsRes,
    inventoryRes,
    attributesRes,
    specsRes,
    attributeValuesRes,
  ] = await Promise.all([
    // Note: we DON'T filter by active=true here — the resolver itself
    // drops inactive associations during evaluation. Keeping inactive
    // rows in the dataset lets the storefront debug panel
    // (?debug_related=1) report on associations the admin disabled, so
    // a "why isn't this showing?" question has a definitive answer
    // rather than just "no active association matched".
    admin
      .from("related_products_associations")
      .select("*")
      .order("display_order", { ascending: true }),
    admin.from("related_products_filter_groups").select("*").order("sort_order"),
    admin
      .from("related_products_filter_conditions")
      .select("*")
      .order("sort_order"),
    admin.from("related_products_manual_picks").select("*").order("sort_order"),
    admin
      .from("products")
      .select("id, name, created_at")
      .eq("active", true),
    admin.from("product_categories").select("product_id, category_id"),
    admin.from("categories").select("id, parent_id"),
    admin
      .from("product_variants")
      .select("id, product_id, attribute_combo")
      .eq("is_active", true),
    admin
      .from("inventory_items")
      .select("variant_id, quantity_available"),
    // Attribute lookup so we can translate product_variants.attribute_combo
    // (which is slug-keyed: `{color: <value_uuid>, size: <value_uuid>}`)
    // into UUID-keyed form for the resolver. Conditions store
    // `attribute_id` as the attribute UUID — without this translation
    // every `attribute_value` / `attribute_value_in` / `attribute_present`
    // check returns 0 because the key shape doesn't line up.
    admin.from("attributes").select("id, slug"),
    // Product specifications — product-level facts (Καστόρι, 18650, etc).
    // Loaded so attribute_value / attribute_value_in / attribute_present
    // conditions can match when the attribute is attached as a spec
    // rather than as a variant axis. value column is plain text and
    // gets resolved against attribute_values below.
    admin
      .from("product_specifications")
      .select("product_id, attribute_id, value"),
    // attribute_values registry: (attribute_id, value_text) → value_id.
    // Spec rows store the value as plain text; conditions reference the
    // value_id UUID. We resolve text → UUID once here so the resolver
    // can compare UUID-to-UUID downstream.
    admin.from("attribute_values").select("id, attribute_id, value"),
  ]);

  // ─── 1. Build category-ancestor expander ────────────────────────
  const categoryParent = new Map<string, string | null>();
  for (const c of (categoriesRes.data ?? []) as Array<{
    id: string;
    parent_id: string | null;
  }>) {
    categoryParent.set(c.id, c.parent_id);
  }
  function ancestorsOf(categoryId: string): string[] {
    const out: string[] = [];
    let cur: string | null = categoryId;
    const seen = new Set<string>();
    while (cur !== null) {
      if (seen.has(cur)) break; // cycle guard
      seen.add(cur);
      out.push(cur);
      cur = categoryParent.get(cur) ?? null;
    }
    return out;
  }

  // ─── 2. Build product → expanded category_ids ───────────────────
  const directByProduct = new Map<string, string[]>();
  for (const pc of (productCategoriesRes.data ?? []) as Array<{
    product_id: string;
    category_id: string;
  }>) {
    (directByProduct.get(pc.product_id) ?? directByProduct.set(pc.product_id, []).get(pc.product_id)!).push(pc.category_id);
  }

  // ─── 3. Build variant index per product (with attributes + stock) ─
  type VariantRow = {
    id: string;
    product_id: string;
    attribute_combo: Record<string, string> | null;
  };
  // Attribute SLUG → UUID lookup. `attribute_combo` is stored
  // slug-keyed (e.g. `{color: <value_uuid>}`), but the resolver
  // compares against `attribute_id` UUIDs from saved conditions —
  // we rewrite the combo to UUID-keyed shape here, exactly once,
  // so every downstream check works without per-condition
  // translation.
  const attrIdBySlug = new Map<string, string>();
  for (const a of (attributesRes.data ?? []) as Array<{
    id: string;
    slug: string;
  }>) {
    attrIdBySlug.set(a.slug, a.id);
  }
  const variantsByProduct = new Map<
    string,
    Array<{
      id: string;
      attributes: Record<string, string>;
      quantity_available: number;
    }>
  >();
  const stockByVariant = new Map<string, number>();
  for (const inv of (inventoryRes.data ?? []) as Array<{
    variant_id: string;
    quantity_available: number;
  }>) {
    stockByVariant.set(inv.variant_id, inv.quantity_available);
  }
  for (const v of (variantsRes.data ?? []) as VariantRow[]) {
    const rawAttrs =
      (v.attribute_combo && typeof v.attribute_combo === "object"
        ? v.attribute_combo
        : {}) as Record<string, string>;
    // Translate slug-keyed → UUID-keyed. Combos with a slug that
    // doesn't resolve (orphan attribute, possibly renamed) drop
    // that key silently — better than throwing and breaking the
    // page; the unresolved entries just won't match any condition.
    const attrs: Record<string, string> = {};
    for (const [slug, valueId] of Object.entries(rawAttrs)) {
      const attrId = attrIdBySlug.get(slug);
      if (attrId) attrs[attrId] = valueId;
    }
    const stock = stockByVariant.get(v.id) ?? 0;
    const list = variantsByProduct.get(v.product_id) ?? [];
    list.push({ id: v.id, attributes: attrs, quantity_available: stock });
    variantsByProduct.set(v.product_id, list);
  }

  // ─── 4. Build product spec_attributes map ────────────────────────
  // product_specifications.value is plain text; conditions reference the
  // attribute_values.id UUID. We build an (attribute_id, value_text) →
  // value_id lookup once, then collapse each spec row into a single
  // entry on the product's spec_attributes map. Free-form spec values
  // (text that doesn't appear in attribute_values for that attribute)
  // are dropped — they can't satisfy an attribute_value condition that
  // points at a specific UUID.
  type AttrValueRow = { id: string; attribute_id: string; value: string };
  const valueIdByAttrAndText = new Map<string, string>();
  const attrValueKey = (attrId: string, text: string) => `${attrId}::${text}`;
  for (const av of (attributeValuesRes.data ?? []) as AttrValueRow[]) {
    valueIdByAttrAndText.set(attrValueKey(av.attribute_id, av.value), av.id);
  }
  type SpecRow = { product_id: string; attribute_id: string; value: string };
  const specsByProduct = new Map<string, Record<string, string>>();
  for (const s of (specsRes.data ?? []) as SpecRow[]) {
    const valueId = valueIdByAttrAndText.get(
      attrValueKey(s.attribute_id, s.value)
    );
    if (!valueId) continue; // free-form spec — can't be matched by UUID condition
    const map = specsByProduct.get(s.product_id) ?? {};
    map[s.attribute_id] = valueId;
    specsByProduct.set(s.product_id, map);
  }

  // ─── 5. Compose ResolverProductData ─────────────────────────────
  const productsList: ResolverProductData[] = [];
  const productsById = new Map<string, ResolverProductData>();
  for (const p of (productsRes.data ?? []) as Array<{
    id: string;
    name: string;
    created_at: string;
  }>) {
    const directCats = directByProduct.get(p.id) ?? [];
    const expanded = new Set<string>();
    for (const c of directCats) {
      for (const ancestor of ancestorsOf(c)) expanded.add(ancestor);
    }
    const data: ResolverProductData = {
      id: p.id,
      name: p.name,
      created_at: p.created_at,
      category_ids: Array.from(expanded),
      variants: variantsByProduct.get(p.id) ?? [],
      spec_attributes: specsByProduct.get(p.id) ?? {},
    };
    productsList.push(data);
    productsById.set(p.id, data);
  }

  // ─── 6. Compose RelatedProductsAssociationFull list ─────────────
  const conditionsByGroup: Record<string, RelatedProductsFilterCondition[]> =
    {};
  for (const c of (conditionsRes.data ?? []) as RelatedProductsFilterCondition[]) {
    (conditionsByGroup[c.filter_group_id] ??= []).push(c);
  }
  const groupsByAssoc: Record<
    string,
    RelatedProductsFilterGroupWithConditions[]
  > = {};
  for (const g of (groupsRes.data ?? []) as RelatedProductsFilterGroup[]) {
    (groupsByAssoc[g.association_id] ??= []).push({
      ...g,
      conditions: conditionsByGroup[g.id] ?? [],
    });
  }
  const picksByAssoc: Record<string, RelatedProductsManualPick[]> = {};
  for (const p of (picksRes.data ?? []) as RelatedProductsManualPick[]) {
    (picksByAssoc[p.association_id] ??= []).push(p);
  }
  const associations: RelatedProductsAssociationFull[] = (
    (associationsRes.data ?? []) as RelatedProductsAssociation[]
  ).map((a) => {
    const allGroups = groupsByAssoc[a.id] ?? [];
    return {
      ...a,
      source_groups: allGroups.filter((g) => g.side === "source"),
      target_groups: allGroups.filter((g) => g.side === "target"),
      manual_picks: picksByAssoc[a.id] ?? [],
    };
  });

  return { associations, productsById, productsList };
}

