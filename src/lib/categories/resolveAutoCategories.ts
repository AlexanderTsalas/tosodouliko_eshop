import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolve which AUTO (dynamic, rule-based) categories each product belongs
 * to. Auto categories don't materialise a `product_categories` row — their
 * membership is computed from `auto_rules.attribute_filters`. This mirrors
 * the membership semantics in `searchVariants` (the storefront's category →
 * products direction) so admin displays agree with the storefront:
 *
 *   - Filters are `{ attributeSlug: valueId[] }`.
 *   - OR within an attribute, AND across attributes.
 *   - A slug is satisfied by a product SPEC (applies to the whole product)
 *     OR by a variant's `attribute_combo`.
 *   - Membership = there EXISTS one active variant that satisfies every
 *     not-spec-satisfied slug (matching searchVariants' variant-level pass),
 *     OR all slugs are spec-satisfied.
 *
 * IMPORTANT: keep this in sync with the matching logic in
 * `src/lib/site-search/searchVariants.ts` — they encode the same rule.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AutoCategoryMatch {
  id: string;
  name: string;
}

export async function resolveAutoCategories(
  supabase: SupabaseClient,
  productIds: string[]
): Promise<Map<string, AutoCategoryMatch[]>> {
  const result = new Map<string, AutoCategoryMatch[]>();
  if (productIds.length === 0) return result;

  // 1. Active auto categories with non-empty rules.
  const { data: catRows } = await supabase
    .from("categories")
    .select("id, name, auto_rules")
    .eq("mode", "auto")
    .eq("active", true);
  type CatRow = {
    id: string;
    name: string;
    auto_rules: { attribute_filters?: Record<string, string[]> } | null;
  };
  const autoCats = ((catRows ?? []) as CatRow[])
    .map((c) => ({
      id: c.id,
      name: c.name,
      filters: c.auto_rules?.attribute_filters ?? {},
    }))
    .filter((c) => Object.values(c.filters).some((v) => v.length > 0));
  if (autoCats.length === 0) return result;

  // 2. Active variants' combos, grouped by product.
  const { data: varRows } = await supabase
    .from("product_variants")
    .select("product_id, attribute_combo")
    .in("product_id", productIds)
    .eq("is_active", true);
  const variantsByProduct = new Map<string, Array<Record<string, string> | null>>();
  for (const r of (varRows ?? []) as Array<{
    product_id: string;
    attribute_combo: Record<string, string> | null;
  }>) {
    const arr = variantsByProduct.get(r.product_id) ?? [];
    arr.push(r.attribute_combo);
    variantsByProduct.set(r.product_id, arr);
  }

  // 3. Specs (slug → value texts), grouped by product.
  const { data: specRows } = await supabase
    .from("product_specifications")
    .select("product_id, value, attributes!inner(slug)")
    .in("product_id", productIds);
  const specsByProduct = new Map<string, Map<string, Set<string>>>();
  for (const row of (specRows ?? []) as Array<{
    product_id: string;
    value: string;
    attributes: { slug: string } | { slug: string }[] | null;
  }>) {
    const attr = Array.isArray(row.attributes) ? row.attributes[0] : row.attributes;
    if (!attr?.slug) continue;
    let m = specsByProduct.get(row.product_id);
    if (!m) {
      m = new Map();
      specsByProduct.set(row.product_id, m);
    }
    const s = m.get(attr.slug) ?? new Set<string>();
    s.add(row.value);
    m.set(attr.slug, s);
  }

  // 4. Translate UUID-shaped filter values → spec text (specs store text).
  const allUuids = new Set<string>();
  for (const c of autoCats) {
    for (const vals of Object.values(c.filters)) {
      for (const v of vals) if (UUID_RE.test(v)) allUuids.add(v);
    }
  }
  const textByUuid = new Map<string, string>();
  if (allUuids.size > 0) {
    const { data: avRows } = await supabase
      .from("attribute_values")
      .select("id, value")
      .in("id", Array.from(allUuids));
    for (const r of (avRows ?? []) as Array<{ id: string; value: string }>) {
      textByUuid.set(r.id, r.value);
    }
  }
  const specText = (filterVal: string) =>
    UUID_RE.test(filterVal) ? textByUuid.get(filterVal) : filterVal;

  // 5. Match each product against each auto category.
  for (const pid of productIds) {
    const variants = variantsByProduct.get(pid) ?? [];
    const specs = specsByProduct.get(pid) ?? new Map<string, Set<string>>();
    const matched: AutoCategoryMatch[] = [];

    for (const cat of autoCats) {
      const slugs = Object.keys(cat.filters).filter(
        (s) => cat.filters[s].length > 0
      );

      // Slugs satisfied by a product spec apply to ALL variants; the rest
      // must be covered together by a SINGLE variant's combo.
      const remaining: string[] = [];
      for (const slug of slugs) {
        const allowed = cat.filters[slug];
        const specVals = specs.get(slug);
        const specHit =
          !!specVals &&
          allowed.some((a) => {
            const t = specText(a);
            return t !== undefined && specVals.has(t);
          });
        if (!specHit) remaining.push(slug);
      }

      const covered =
        remaining.length === 0 ||
        variants.some(
          (combo) =>
            combo != null &&
            remaining.every((slug) => {
              const cv = combo[slug];
              return typeof cv === "string" && cat.filters[slug].includes(cv);
            })
        );

      if (covered) matched.push({ id: cat.id, name: cat.name });
    }

    if (matched.length > 0) result.set(pid, matched);
  }

  return result;
}
