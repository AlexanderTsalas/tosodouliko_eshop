/**
 * Resolve the effective splitter-attribute slugs for a single product, given
 * the global flag on each attribute and any per-product override map.
 *
 * Rules:
 *   - global splits_listing = true AND not explicitly suppressed → splitter
 *   - global splits_listing = false AND explicitly enabled       → splitter
 *
 * `overrides` is the sparse `products.split_overrides` jsonb.
 */
export function resolveEffectiveSplitters(
  attributes: Array<{ slug: string; splits_listing: boolean }>,
  overrides: Record<string, boolean> | null | undefined
): string[] {
  const out: string[] = [];
  for (const a of attributes) {
    const override = overrides?.[a.slug];
    const on = override === undefined ? a.splits_listing : override;
    if (on) out.push(a.slug);
  }
  return out;
}

export interface PendingPair {
  attributeId: string;
  attributeSlug: string;
  attributeName: string;
  /** The attribute_values.id (uuid). Source of truth for the combo's value. */
  attributeValueId: string;
  /** The attribute_values.value (display text). Used for SKU + label rendering. */
  value: string;
}

/**
 * Combos are stored as { attribute_slug: attribute_value_id }. These helpers
 * resolve a combo to display labels or URL slugs via a values-by-id map.
 */
export interface ValueLookup {
  id: string;
  attribute_id: string;
  value: string;
  slug: string;
}

/** UUID-keyed map of attribute_values for fast combo resolution. */
export type ValuesById = Map<string, ValueLookup>;

export function buildValuesById(values: ValueLookup[]): ValuesById {
  const m = new Map<string, ValueLookup>();
  for (const v of values) m.set(v.id, v);
  return m;
}

/**
 * Resolve a combo's UUIDs to display values. Missing UUIDs are skipped — a
 * silent drop is safer than rendering a UUID string to the customer (the
 * triggers prevent this state in practice).
 */
export function resolveComboLabels(
  combo: Record<string, string> | null,
  valuesById: ValuesById
): Record<string, string> {
  if (!combo) return {};
  const out: Record<string, string> = {};
  for (const [slug, uuid] of Object.entries(combo)) {
    const v = valuesById.get(uuid);
    if (v) out[slug] = v.value;
  }
  return out;
}

/** Same as resolveComboLabels but returns the URL-safe slug for each value. */
export function resolveComboSlugs(
  combo: Record<string, string> | null,
  valuesById: ValuesById
): Record<string, string> {
  if (!combo) return {};
  const out: Record<string, string> = {};
  for (const [slug, uuid] of Object.entries(combo)) {
    const v = valuesById.get(uuid);
    if (v) out[slug] = v.slug;
  }
  return out;
}

/**
 * Render a combo as a flat "Flavour Profile: Strawberry · Bottle Size: 30ml"
 * label string. Used for variant_label snapshots on orders, supply orders,
 * wishlist notifications, etc. Returns null when the combo is null/empty.
 */
export function renderComboLabel(
  combo: Record<string, string> | null,
  valuesById: ValuesById,
  attributesBySlug: Map<string, { name: string }>
): string | null {
  if (!combo) return null;
  const parts: string[] = [];
  for (const [slug, uuid] of Object.entries(combo)) {
    const v = valuesById.get(uuid);
    const a = attributesBySlug.get(slug);
    if (!v || !a) continue;
    parts.push(`${a.name}: ${v.value}`);
  }
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

/**
 * Cartesian product of (type, value) pairs grouped by attribute type.
 *
 *   [Flavour:Lemon, Flavour:Strawberry, Size:S, Size:L]
 *     ⇒ [
 *       [Flavour:Lemon,      Size:S],
 *       [Flavour:Lemon,      Size:L],
 *       [Flavour:Strawberry, Size:S],
 *       [Flavour:Strawberry, Size:L],
 *     ]
 *
 * Empty input ⇒ a single empty combination (one variant, no attributes).
 */
export function combinationsFromPairs(pairs: PendingPair[]): PendingPair[][] {
  if (pairs.length === 0) return [[]];
  const groups = new Map<string, PendingPair[]>();
  for (const p of pairs) {
    const list = groups.get(p.attributeSlug) ?? [];
    list.push(p);
    groups.set(p.attributeSlug, list);
  }
  let acc: PendingPair[][] = [[]];
  for (const group of groups.values()) {
    const next: PendingPair[][] = [];
    for (const partial of acc) {
      for (const p of group) {
        next.push([...partial, p]);
      }
    }
    acc = next;
  }
  return acc;
}

/**
 * Canonical key for a combination — sort by attribute slug, join
 * `<slug>=<value_id>`. Stable regardless of pair-add order. Used by the
 * combo picker UI (skipped-key sets, price-override keys) and by anyone
 * needing to compare two combos for equality.
 *
 * Accepts either a PendingPair[] (create-form context) or a flat
 * Record<slug, attribute_value_id> (existing-variant context).
 */
export function comboKey(
  combo: PendingPair[] | Record<string, string>
): string {
  if (Array.isArray(combo)) {
    return combo
      .slice()
      .sort((a, b) => a.attributeSlug.localeCompare(b.attributeSlug))
      .map((p) => `${p.attributeSlug}=${p.attributeValueId}`)
      .join("|");
  }
  return Object.entries(combo)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, id]) => `${slug}=${id}`)
    .join("|");
}

/**
 * Convert a flat { slug → attribute_value_id } combo into the
 * PendingPair[] format the picker consumes. Looks up the display name +
 * text value from the attribute/value catalogs. Drops entries whose
 * attribute or value can't be resolved (defensive — should never happen
 * given the DB triggers).
 */
export function comboToPairs(
  combo: Record<string, string>,
  attributes: Array<{ id: string; slug: string; name: string }>,
  values: Array<{ id: string; attribute_id: string; value: string }>
): PendingPair[] {
  const attrBySlug = new Map(attributes.map((a) => [a.slug, a]));
  const valueById = new Map(values.map((v) => [v.id, v]));
  const pairs: PendingPair[] = [];
  for (const [slug, valueId] of Object.entries(combo)) {
    const attr = attrBySlug.get(slug);
    const val = valueById.get(valueId);
    if (!attr || !val) continue;
    pairs.push({
      attributeId: attr.id,
      attributeSlug: attr.slug,
      attributeName: attr.name,
      attributeValueId: val.id,
      value: val.value,
    });
  }
  return pairs;
}

/**
 * Inverse of comboToPairs — flatten the picker's PendingPair[] back to
 * the JSONB-storage Record<slug, attribute_value_id> shape that
 * attribute_combo + the addAxis* server actions consume.
 */
export function pairsToCombo(pairs: PendingPair[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs) out[p.attributeSlug] = p.attributeValueId;
  return out;
}

/**
 * Greek → Latin transliteration table. Lowercase only — callers must
 * lowercase before lookup. Covers monotonic + polytonic accented forms
 * (NFKD normalization in the slugifier collapses accents first, so this
 * map only needs the unaccented base letters).
 */
const GREEK_TO_LATIN: Record<string, string> = {
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th",
  ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o", π: "p",
  ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
};

/**
 * Slugify a string for use in URLs and SKUs. Greek letters are
 * transliterated to Latin ("Φράουλα" → "fraoula"), all other non-ASCII is
 * normalized then stripped. Output is always [a-z0-9-].
 */
export function slugifyValue(input: string): string {
  const lower = input.toLowerCase().normalize("NFKD");
  let transliterated = "";
  for (const ch of lower) {
    if (GREEK_TO_LATIN[ch]) {
      transliterated += GREEK_TO_LATIN[ch];
    } else {
      transliterated += ch;
    }
  }
  return transliterated
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Build a SKU for a given combination — base alone if N=1, else base + slugified suffix. */
export function buildVariantSku(
  baseSku: string,
  combination: PendingPair[],
  totalCombinations: number
): string {
  if (totalCombinations <= 1 || combination.length === 0) return baseSku;
  return baseSku + "-" + combination.map((p) => slugifyValue(p.value)).join("-");
}

/**
 * Build the variant-slug suffix used in storefront URLs. Only includes
 * attributes that split the catalog listing (so the URL doesn't bloat with
 * non-splitting dimensions). Attributes are sorted alphabetically by slug
 * so the suffix is deterministic.
 *
 *   product slug:           "vape-x"
 *   combo (UUIDs):          { flavour: "<uuid-strawberry>", size: "<uuid-30ml>" }
 *   splitting attr slugs:   ["flavour"]
 *   valuesById resolves the strawberry uuid → slug "strawberry"
 *   → "strawberry"
 *
 * Returns "" when no splitting attributes apply (the bare product URL).
 */
export function buildVariantSlugSuffix(
  combo: Record<string, string> | null,
  splittingAttributeSlugs: string[],
  valuesById: ValuesById
): string {
  if (!combo) return "";
  const splittingSet = new Set(splittingAttributeSlugs);
  const entries = Object.entries(combo)
    .filter(([slug]) => splittingSet.has(slug))
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "";
  const parts: string[] = [];
  for (const [, uuid] of entries) {
    const v = valuesById.get(uuid);
    if (!v) return ""; // unresolvable → skip the suffix (defensive)
    parts.push(v.slug);
  }
  return parts.join("-");
}

/**
 * Minimal attribute/value shapes that the price computer needs. Both
 * `Attribute` from @/types/attribute-facets and `AttributeValue` satisfy
 * these — we keep the helper free of upstream type imports so it can live
 * in a shared client/server module.
 */
export interface AttrLike {
  id: string;
  slug: string;
  name: string;
  affects_price: boolean;
}
export interface AttrValueLike {
  id: string;
  attribute_id: string;
  value: string;
  price_modifier: number;
}

export interface PriceBreakdown {
  attributeName: string;
  attributeSlug: string;
  value: string;
  modifier: number;
}

export interface ComputedPrice {
  total: number;
  base: number;
  breakdown: PriceBreakdown[];
}

/**
 * Compute the suggested variant price = base + Σ(modifiers for each value in
 * the combo whose parent attribute has affects_price=true).
 *
 * `combo` is either:
 *   - a flat array of `PendingPair` (used in create form)
 *   - a Record<slug, attribute_value_id> stored on an existing variant
 */
export function computeVariantPrice(
  basePrice: number,
  combo: PendingPair[] | Record<string, string>,
  attributes: AttrLike[],
  values: AttrValueLike[]
): ComputedPrice {
  const bySlug = new Map<string, AttrLike>();
  for (const a of attributes) bySlug.set(a.slug, a);
  const valuesById = new Map<string, AttrValueLike>();
  for (const v of values) valuesById.set(v.id, v);

  // Normalise to { slug, attributeValueId } entries.
  const entries: Array<{ slug: string; attributeValueId: string }> = Array.isArray(combo)
    ? combo.map((p) => ({ slug: p.attributeSlug, attributeValueId: p.attributeValueId }))
    : Object.entries(combo).map(([slug, uuid]) => ({ slug, attributeValueId: uuid }));

  const breakdown: PriceBreakdown[] = [];
  let total = basePrice;

  for (const e of entries) {
    const attr = bySlug.get(e.slug);
    if (!attr || !attr.affects_price) continue;

    const av = valuesById.get(e.attributeValueId);
    if (!av || av.attribute_id !== attr.id || av.price_modifier === 0) continue;

    total += Number(av.price_modifier);
    breakdown.push({
      attributeName: attr.name,
      attributeSlug: attr.slug,
      value: av.value,
      modifier: Number(av.price_modifier),
    });
  }

  return {
    total: Math.round(total * 100) / 100,
    base: basePrice,
    breakdown,
  };
}
