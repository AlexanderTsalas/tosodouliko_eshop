import { createClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/types/result";
import {
  buildVariantSlugSuffix,
  buildValuesById,
  resolveEffectiveSplitters,
  type ValueLookup,
} from "@/lib/variants-helpers";
import { resolveShowWhenOosForVariants } from "@/lib/storefront/resolveOosVisibility";
import { selectCoverImageForVariant } from "@/lib/products/selectImagesForVariant";
import { resolveProductImageUrl } from "@/lib/media/resolveProductImageUrl";
import { evaluateOffersForVariantSet } from "@/lib/offers";
import { getContestableAvailableForVariants } from "@/lib/inventory/getContestableAvailable";
import type { Product, ProductImage } from "@/types/products";
import type { ProductVariant } from "@/types/product-variants";
import type { RuleKind } from "@/types/offers";

/**
 * Minimal subset of a `Rule` + its action needed for badge rendering
 * on the catalog tile (v2.4).
 */
export interface OfferRuleSummary {
  id: string;
  kind: RuleKind;
  /** For price_discount only. */
  action_mode: "percent" | "flat" | null;
  /** For price_discount only. */
  action_value: number | null;
  /** For service_cost_exception only. */
  action_fee_kind: "delivery" | "cod" | "all" | null;
  /** True if the rule has an available_quantity condition — drives the
   *  "ΤΕΛΕΥΤΑΙΑ ΤΕΜΑΧΙΑ" urgency badge. */
  has_available_quantity_condition: boolean;
}

export interface CatalogCard {
  /** Unique key for React: product id + splitter values (or just product id). */
  cardKey: string;
  product: Product;
  /** The variant chosen to represent this card (its image + price drive the card). */
  variant: ProductVariant;
  /** Splitter slug→value, just the dimensions that actually split. Empty = no splitter. */
  splitterValues: Record<string, string>;
  /** Image to show on the card. Variant-scoped if available, else product primary. */
  image: ProductImage | null;
  /** Full storefront URL: /products/<product-slug>[-<value-slug-1>-<value-slug-2>] */
  href: string;
  /** Names of the splitter attributes (for chip labels on the card). */
  splitterAttributeNames: Record<string, string>;
  /**
   * True iff every variant behind this card (same splitter combo, all
   * non-splitter dimensions) is fully sold out — contestable stock zero
   * across the group. Cards only appear here when at least one such
   * variant survives the show_when_oos cascade, so an out_of_stock=true
   * card is one the merchant has explicitly kept browseable for the
   * wishlist / notify-me flow.
   */
  out_of_stock: boolean;
  /**
   * Auto-apply offer state for this card's variant — computed from
   * the offers engine (Phase 3 wiring). Null when no auto-apply rule
   * touches this variant. When present, `effective_price < original_price`
   * means a discount applies; the rule_id can be looked up in
   * `offer_rules_by_id` to render the badge.
   */
  offer_state: {
    effective_price: number;
    original_price: number;
    rule_id: string;
  } | null;
}

export interface SearchVariantsInput {
  q?: string;
  categorySlug?: string;
  minPrice?: number;
  maxPrice?: number;
  ageMin?: number;
  ageMax?: number;
  /**
   * attribute_slug → array of attribute_value UUIDs to keep (OR within
   * attribute, AND across attributes). UUIDs are matched against variants'
   * attribute_combo; product_specifications matching translates the UUIDs
   * back to display text via attribute_values to keep specs (which store
   * free text) compatible.
   */
  attributeFilters?: Record<string, string[]>;
  /**
   * Restrict the result to a specific set of product UUIDs. Used by
   * the related-products carousels — the resolver picks product ids
   * and then leans on `searchVariants` to do the variant fan-out +
   * image resolution + offer evaluation in a single consistent path.
   * When undefined or empty, no product-id filter is applied.
   */
  productIds?: string[];
  /**
   * Catalog sort order applied to the assembled cards before pagination.
   * Price sorts use the variant list price (offers are applied post-slice).
   * Undefined keeps the default (newest-first) ordering.
   */
  sort?: "newest" | "price_asc" | "price_desc" | "name";
  limit?: number;
  offset?: number;
}

export interface SearchVariantsResult {
  cards: CatalogCard[];
  /**
   * Lookup of rules referenced by `card.offer_state.rule_id`, for badge
   * rendering at the page level. Empty object when no card has an
   * offer applied.
   */
  offer_rules_by_id: Record<string, OfferRuleSummary>;
  cardCount: number;
  /** Distinct products represented in `cards` — useful for headline counts. */
  productCount: number;
}

/**
 * Variant-grained catalog query that returns "cards" — one per (product,
 * splitter-value-combination). Products without any splitter attributes
 * produce a single card.
 *
 * The expansion happens server-side after fetching variants because the
 * splitter set is small and stable; the GIN index on attribute_combo makes
 * the variant query fast even with attribute filters.
 */
export async function searchVariants(
  input: SearchVariantsInput = {}
): Promise<Result<SearchVariantsResult>> {
  const supabase = await createClient();
  const limit = Math.min(input.limit ?? 48, 200);
  const offset = Math.max(input.offset ?? 0, 0);

  // 1. Find products matching the product-level filters.
  let productQuery = supabase
    .from("products")
    .select("*")
    .eq("active", true);

  if (input.productIds && input.productIds.length > 0) {
    productQuery = productQuery.in("id", input.productIds);
  }

  if (input.q && input.q.trim()) {
    const term = `%${input.q.trim().replace(/[%_]/g, "\\$&")}%`;
    productQuery = productQuery.or(`name.ilike.${term},description.ilike.${term},brand.ilike.${term}`);
  }
  if (typeof input.minPrice === "number") productQuery = productQuery.gte("base_price", input.minPrice);
  if (typeof input.maxPrice === "number") productQuery = productQuery.lte("base_price", input.maxPrice);
  if (typeof input.ageMin === "number") productQuery = productQuery.gte("age_min", input.ageMin);
  if (typeof input.ageMax === "number") productQuery = productQuery.lte("age_max", input.ageMax);

  // Resolve category (manual or auto). Manual narrows the product set via the
  // join table; auto contributes its rule filters and skips the join.
  let autoCategoryFilters: Record<string, string[]> | null = null;
  if (input.categorySlug) {
    const { data: cat } = await supabase
      .from("categories")
      .select("id, mode, auto_rules")
      .eq("slug", input.categorySlug)
      .maybeSingle();
    if (!cat) return ok({ cards: [], cardCount: 0, productCount: 0, offer_rules_by_id: {} });
    const category = cat as {
      id: string;
      mode: "manual" | "auto";
      auto_rules: { attribute_filters: Record<string, string[]> } | null;
    };
    if (category.mode === "auto") {
      autoCategoryFilters = category.auto_rules?.attribute_filters ?? {};
      const hasAny = Object.values(autoCategoryFilters).some((vs) => vs.length > 0);
      if (!hasAny) return ok({ cards: [], cardCount: 0, productCount: 0, offer_rules_by_id: {} });
    } else {
      const { data: pcRows } = await supabase
        .from("product_categories")
        .select("product_id")
        .eq("category_id", category.id);
      const ids = (pcRows ?? []).map((r: { product_id: string }) => r.product_id);
      if (ids.length === 0) return ok({ cards: [], cardCount: 0, productCount: 0, offer_rules_by_id: {} });
      productQuery = productQuery.in("id", ids);
    }
  }

  const [{ data: products, error: productsErr }, { data: attrs }] =
    await Promise.all([
      productQuery.order("created_at", { ascending: false }),
      supabase.from("attributes").select("*"),
    ]);
  if (productsErr) return fail<SearchVariantsResult>(productsErr.message, productsErr.code);

  const productList = (products ?? []) as Product[];
  if (productList.length === 0) {
    return ok({ cards: [], cardCount: 0, productCount: 0, offer_rules_by_id: {} });
  }
  const allAttributes = (attrs ?? []) as Array<{
    id: string;
    slug: string;
    name: string;
    splits_listing: boolean;
  }>;
  // Name lookup covers every attribute that any product could opt-in to splitting.
  const allAttributeNames: Record<string, string> = Object.fromEntries(
    allAttributes.map((a) => [a.slug, a.name])
  );

  // 3. Fetch active variants for the matched products. We pull every active
  //    variant (regardless of stock) and post-filter against the
  //    show_when_oos cascade: a variant survives if it's in stock OR if its
  //    resolved show_when_oos = true (visible-while-OOS, keeps the wishlist
  //    flow alive). The inventory_items join stays so we know stock; the
  //    LEFT join handles the (theoretical) case of a variant with no
  //    inventory row.
  const productIds = productList.map((p) => p.id);
  const variantQuery = supabase
    .from("product_variants")
    .select(
      "*, inventory_items(quantity_available, quantity_soft_held, quantity_priority_held)"
    )
    .in("product_id", productIds)
    .eq("is_active", true);

  // Merge user-selected attribute filters with the auto-category's filters.
  // Both sides apply OR-within-attribute and AND-across-attributes.
  const combinedFilters: Record<string, string[]> = {};
  if (autoCategoryFilters) {
    for (const [slug, vals] of Object.entries(autoCategoryFilters)) {
      if (vals.length > 0) combinedFilters[slug] = [...vals];
    }
  }
  if (input.attributeFilters) {
    for (const [slug, vals] of Object.entries(input.attributeFilters)) {
      if (vals.length === 0) continue;
      if (combinedFilters[slug]) {
        const auto = new Set(combinedFilters[slug]);
        combinedFilters[slug] = vals.filter((v) => auto.has(v));
        if (combinedFilters[slug].length === 0) {
          return ok({ cards: [], cardCount: 0, productCount: 0, offer_rules_by_id: {} });
        }
      } else {
        combinedFilters[slug] = [...vals];
      }
    }
  }

  // Resolve which products satisfy each filter via product_specifications
  // (the spec attaches to the whole product, so ALL its variants pass the
  // filter regardless of attribute_combo). Specs store free text, so we
  // translate each filter value to display text before querying.
  //
  // Facet keys are dual-source (see getCatalogFacets §5a/§5b):
  //   - Variant axes contribute UUID keys (attribute_values.id)
  //   - Spec values contribute TEXT keys (product_specifications.value)
  //
  // To support both, we look up UUID-shaped filter ids in
  // attribute_values, and accept non-UUID ids verbatim as text. Without
  // the second branch, spec-only facets used to send their TEXT key into
  // a UUID-only lookup, produce an empty filterValueText map, and then
  // the spec-match check would always fail — leaving the customer with
  // an empty result set despite the facet showing matching counts.
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const allFilterIds = new Set<string>();
  for (const values of Object.values(combinedFilters)) {
    for (const id of values) allFilterIds.add(id);
  }
  const filterValueTextByUuid = new Map<string, string>();
  const uuidShapedIds = Array.from(allFilterIds).filter((s) => UUID_RE.test(s));
  if (uuidShapedIds.length > 0) {
    const { data: vRows } = await supabase
      .from("attribute_values")
      .select("id, value")
      .in("id", uuidShapedIds);
    for (const r of (vRows ?? []) as Array<{ id: string; value: string }>) {
      filterValueTextByUuid.set(r.id, r.value);
    }
  }
  // Non-UUID filter values are already raw spec text — pass through.
  for (const id of allFilterIds) {
    if (!UUID_RE.test(id)) filterValueTextByUuid.set(id, id);
  }

  // Batched spec-match pass — ONE query covering every (slug, text) pair
  // across all active attribute filters, bucketed back per slug in JS.
  // Earlier this ran a sequential query per slug inside a `for` loop, which
  // turned a 10-attribute catalog filter into 10 sequential round-trips on
  // the hottest storefront page. The batched query is a single trip; the
  // JS post-filter (validPairs) enforces (slug, value) integrity so a text
  // value present under multiple attributes can't bleed across.
  const specMatchByFilter = new Map<string, Set<string>>();
  const allFilterSlugs = Object.keys(combinedFilters);
  // Pre-seed every slug so the downstream `.get(slug)?.has(...)` lookup
  // returns a non-undefined Set even when a slug has zero candidate texts.
  for (const slug of allFilterSlugs) specMatchByFilter.set(slug, new Set());

  if (allFilterSlugs.length > 0 && productIds.length > 0) {
    const validPairs = new Map<string, Set<string>>();
    const allTexts = new Set<string>();
    for (const [slug, uuids] of Object.entries(combinedFilters)) {
      const texts = uuids
        .map((u) => filterValueTextByUuid.get(u))
        .filter((s): s is string => typeof s === "string");
      if (texts.length === 0) continue;
      validPairs.set(slug, new Set(texts));
      for (const t of texts) allTexts.add(t);
    }

    if (validPairs.size > 0) {
      const { data: specRows } = await supabase
        .from("product_specifications")
        .select("product_id, value, attributes!inner(slug)")
        .in("attributes.slug", Array.from(validPairs.keys()))
        .in("value", Array.from(allTexts))
        .in("product_id", productIds);
      type SpecRow = {
        product_id: string;
        value: string;
        attributes: { slug: string } | { slug: string }[] | null;
      };
      for (const row of (specRows ?? []) as SpecRow[]) {
        const attr = Array.isArray(row.attributes)
          ? row.attributes[0]
          : row.attributes;
        const slug = attr?.slug;
        if (!slug) continue;
        const allowed = validPairs.get(slug);
        // Cross-attribute integrity: discard rows whose (slug, value)
        // pair isn't in the original input. Without this, a text value
        // ("red") used by both `color` and `cover-color` attributes
        // would match the wrong filter.
        if (!allowed || !allowed.has(row.value)) continue;
        specMatchByFilter.get(slug)!.add(row.product_id);
      }
    }
  }

  const { data: variantsData, error: variantsErr } = await variantQuery.order("created_at");
  if (variantsErr) return fail<SearchVariantsResult>(variantsErr.message, variantsErr.code);
  type InventorySnap = {
    quantity_available: number;
    quantity_soft_held: number;
    quantity_priority_held: number;
  };
  type VariantWithInventory = ProductVariant & {
    inventory_items: InventorySnap | InventorySnap[] | null;
  };
  const allVariants = (variantsData ?? []) as VariantWithInventory[];

  // Apply attribute-filter matching first (JS pass).
  const filtered = allVariants.filter((v) => {
    for (const [slug, values] of Object.entries(combinedFilters)) {
      const specMatch = specMatchByFilter.get(slug)?.has(v.product_id) ?? false;
      if (specMatch) continue; // spec match wins for this filter
      const comboVal = v.attribute_combo?.[slug];
      if (typeof comboVal !== "string" || !values.includes(comboVal)) {
        return false;
      }
    }
    return true;
  });

  // Apply the OOS visibility cascade: a variant stays in the result if its
  // stock is positive, OR its resolved show_when_oos is true. The resolver
  // is batched in one round-trip across the candidate set.
  const candidateIds = filtered.map((v) => v.id);
  const visibilityById = await resolveShowWhenOosForVariants(supabase, candidateIds);

  function variantContestable(v: VariantWithInventory): number {
    const inv = Array.isArray(v.inventory_items)
      ? v.inventory_items[0]
      : v.inventory_items;
    return (
      Number(inv?.quantity_available ?? 0) +
      Number(inv?.quantity_soft_held ?? 0) +
      Number(inv?.quantity_priority_held ?? 0)
    );
  }

  const variantList = filtered.filter((v) => {
    // A variant survives the catalog gate if it's still contestable (items
    // available, soft-held, or priority-held — i.e., not all reserved/sold).
    // When fully sold out, the show_when_oos cascade decides visibility.
    const stillContestable = variantContestable(v) > 0;
    if (stillContestable) return true;
    return visibilityById.get(v.id) === true;
  });

  if (variantList.length === 0) {
    return ok({ cards: [], cardCount: 0, productCount: 0, offer_rules_by_id: {} });
  }

  // 3b. Resolve every attribute_value uuid referenced by the kept variants —
  //     needed to compute storefront URL slugs per card.
  const valueIdsInUse = new Set<string>();
  for (const v of variantList) {
    if (!v.attribute_combo) continue;
    for (const id of Object.values(v.attribute_combo)) valueIdsInUse.add(id);
  }

  // 4. Fetch attribute values and product images in parallel (independent reads).
  const [valuesFetchResult, { data: imgs }] = await Promise.all([
    valueIdsInUse.size > 0
      ? supabase
          .from("attribute_values")
          .select("id, attribute_id, value, slug")
          .in("id", Array.from(valueIdsInUse))
      : Promise.resolve({ data: null }),
    supabase
      .from("product_images")
      .select("*")
      .in("product_id", productIds)
      .order("display_order"),
  ]);
  let valuesById: ReturnType<typeof buildValuesById> = new Map();
  if (valueIdsInUse.size > 0) {
    valuesById = buildValuesById(
      ((valuesFetchResult.data ?? []) as ValueLookup[])
    );
  }
  const allImages = (imgs ?? []) as ProductImage[];
  // Bucket by product for the combo-aware selector. The selector
  // operates on the full per-product image set so it can subset-match
  // each card's variant attribute_combo against image.attribute_combo
  // restricted to product.image_axes.
  const imagesByProduct = new Map<string, ProductImage[]>();
  for (const img of allImages) {
    const pList = imagesByProduct.get(img.product_id) ?? [];
    pList.push(img);
    imagesByProduct.set(img.product_id, pList);
  }

  // 5. Build cards. For each product, group its variants by splitter-value-tuple
  //    and pick one representative variant per group.
  const productById = new Map(productList.map((p) => [p.id, p]));
  const cardMap = new Map<string, CatalogCard>();
  // Track max contestable stock across every variant in a card's group so
  // we can mark the card out_of_stock only when ALL backing variants are
  // sold out (not just the representative variant).
  const cardGroupMaxContestable = new Map<string, number>();

  // Per-product effective splitter slugs (global flag ± product overrides).
  const splittersByProduct = new Map<string, string[]>();
  for (const p of productList) {
    splittersByProduct.set(p.id, resolveEffectiveSplitters(allAttributes, p.split_overrides));
  }

  for (const variant of variantList) {
    const product = productById.get(variant.product_id);
    if (!product) continue;

    const productSplitters = splittersByProduct.get(product.id) ?? [];

    // The "splitter values" are only the dimensions of attribute_combo that
    // split for THIS product. Other dimensions stay hidden behind the in-page
    // variant picker. The card chips display the resolved value text, not
    // the underlying UUID.
    const splitterValues: Record<string, string> = {};
    if (variant.attribute_combo) {
      for (const slug of productSplitters) {
        const valueId = variant.attribute_combo[slug];
        if (valueId === undefined) continue;
        const resolved = valuesById.get(valueId);
        if (resolved) splitterValues[slug] = resolved.value;
      }
    }

    // De-dupe key: product + sorted splitter values.
    const suffix = buildVariantSlugSuffix(variant.attribute_combo, productSplitters, valuesById);
    const cardKey = suffix ? `${product.id}::${suffix}` : product.id;

    // Always update the group's max — even for non-representative variants.
    const contestable = variantContestable(variant);
    const prevMax = cardGroupMaxContestable.get(cardKey) ?? 0;
    if (contestable > prevMax) cardGroupMaxContestable.set(cardKey, contestable);

    if (cardMap.has(cardKey)) continue; // Already added a representative for this combo.

    // Image preference uses the combo-aware subset-match algorithm.
    // The card represents a specific variant; the selector picks the
    // cover image whose attribute_combo subset-matches this variant
    // restricted to product.image_axes. Falls back to general images
    // (combo={}) when no variant-specific cover exists.
    const productImages = imagesByProduct.get(product.id) ?? [];
    const image = selectCoverImageForVariant(product, variant, productImages);

    const href = suffix ? `/products/${product.slug}-${suffix}` : `/products/${product.slug}`;

    cardMap.set(cardKey, {
      cardKey,
      product,
      variant,
      splitterValues,
      splitterAttributeNames: allAttributeNames,
      image,
      href,
      out_of_stock: false, // filled in below once the full group is seen
      offer_state: null,  // filled in by the offers-engine pass below
    });
  }

  // Finalize out_of_stock once every variant has been visited (so we know
  // the group max, not just the representative's stock).
  for (const card of cardMap.values()) {
    card.out_of_stock = (cardGroupMaxContestable.get(card.cardKey) ?? 0) === 0;
  }

  const allCards = Array.from(cardMap.values());
  const distinctProducts = new Set(allCards.map((c) => c.product.id));

  // Sort the full card set before paginating. Price uses the variant list
  // price (offer_state isn't computed until after the slice). "newest" reads
  // products.created_at; name is locale-aware Greek.
  const sortKey = input.sort ?? "newest";
  const price = (c: CatalogCard) => Number(c.variant.price);
  allCards.sort((a, b) => {
    switch (sortKey) {
      case "price_asc":
        return price(a) - price(b);
      case "price_desc":
        return price(b) - price(a);
      case "name":
        return a.product.name.localeCompare(b.product.name, "el");
      case "newest":
      default:
        return (b.product.created_at ?? "").localeCompare(a.product.created_at ?? "");
    }
  });

  // Apply pagination on cards (not products).
  const cards = allCards.slice(offset, offset + limit);

  // Resolve image URLs in parallel — only for the cards we'll return.
  // The combo-aware selection happened above using the legacy + new
  // schema; here we ensure every returned image has a non-null url so
  // client components don't need provider awareness.
  await Promise.all(
    cards.map(async (card) => {
      if (card.image) {
        card.image = await resolveProductImageUrl(card.image);
      }
    })
  );

  // ─── Offers engine ───────────────────────────────────────
  //
  // For each card's variant, ask the engine "is there an auto-apply
  // offer that touches this variant? If yes, what's the effective price
  // + which rule is responsible?" The engine handles:
  //   - active offer + active parent (or no parent) filtering
  //   - scope matching (variant/product/category/all)
  //   - stock-threshold per variant (against effective available)
  //   - picks the deepest discount per variant
  //
  // Performance: ONE engine call for ALL cards in the page batch.
  const cardVariantIds = cards.map((c) => c.variant.id);
  const offerRulesById: Record<string, OfferRuleSummary> = {};

  if (cardVariantIds.length > 0) {
    // Effective stock per variant — needed for stock-threshold rules.
    const stockMap = await getContestableAvailableForVariants(cardVariantIds);

    // Build the variantContext map the engine expects.
    const variantContext = new Map<
      string,
      { product_id: string; category_ids: string[]; unit_price: number }
    >();
    // Category IDs per product — single query.
    const cardProductIds = Array.from(
      new Set(cards.map((c) => c.product.id))
    );
    const { data: pcRows } = await supabase
      .from("product_categories")
      .select("product_id, category_id")
      .in("product_id", cardProductIds);
    const categoriesByProduct = new Map<string, string[]>();
    for (const row of (pcRows ?? []) as Array<{
      product_id: string;
      category_id: string;
    }>) {
      const list = categoriesByProduct.get(row.product_id) ?? [];
      list.push(row.category_id);
      categoriesByProduct.set(row.product_id, list);
    }
    for (const card of cards) {
      variantContext.set(card.variant.id, {
        product_id: card.product.id,
        category_ids: categoriesByProduct.get(card.product.id) ?? [],
        unit_price: Number(card.variant.price),
      });
    }

    const offerStates = await evaluateOffersForVariantSet(cardVariantIds, {
      variantContext,
      evaluationTime: new Date(),
      currency: "EUR",
      inventoryByVariant: stockMap,
    });

    // Decorate each card.
    const referencedRuleIds = new Set<string>();
    for (const card of cards) {
      const state = offerStates.get(card.variant.id);
      if (
        state &&
        state.rule_id !== null &&
        state.effective_price < state.original_price
      ) {
        card.offer_state = {
          effective_price: state.effective_price,
          original_price: state.original_price,
          rule_id: state.rule_id,
        };
        referencedRuleIds.add(state.rule_id);
      } else {
        card.offer_state = null;
      }
    }

    // Single batched fetch for rule summaries (badge rendering) — pulls
    // action shape via the relation join, plus the available_quantity
    // condition existence for the urgency badge.
    if (referencedRuleIds.size > 0) {
      const refIds = Array.from(referencedRuleIds);
      const [rulesQ, actionsQ, condsQ] = await Promise.all([
        supabase.from("rules").select("id, kind").in("id", refIds),
        supabase
          .from("rule_actions")
          .select("rule_id, kind, config")
          .in("rule_id", refIds),
        supabase
          .from("rule_conditions")
          .select("rule_id")
          .eq("kind", "available_quantity")
          .in("rule_id", refIds),
      ]);
      const actionsByRuleId = new Map<
        string,
        { kind: string; config: Record<string, unknown> }
      >();
      for (const a of (actionsQ.data ?? []) as Array<{
        rule_id: string;
        kind: string;
        config: Record<string, unknown>;
      }>) {
        actionsByRuleId.set(a.rule_id, { kind: a.kind, config: a.config });
      }
      const hasAvailQty = new Set<string>(
        ((condsQ.data ?? []) as Array<{ rule_id: string }>).map(
          (r) => r.rule_id
        )
      );
      for (const r of (rulesQ.data ?? []) as Array<{
        id: string;
        kind: RuleKind;
      }>) {
        const a = actionsByRuleId.get(r.id);
        let mode: "percent" | "flat" | null = null;
        let value: number | null = null;
        let fee_kind: "delivery" | "cod" | "all" | null = null;
        if (a?.kind === "price_discount") {
          mode = (a.config as { mode: "percent" | "flat" }).mode;
          value = (a.config as { value: number }).value;
        } else if (a?.kind === "service_cost_exception") {
          fee_kind = (a.config as { fee_kind: "delivery" | "cod" | "all" })
            .fee_kind;
        }
        offerRulesById[r.id] = {
          id: r.id,
          kind: r.kind,
          action_mode: mode,
          action_value: value,
          action_fee_kind: fee_kind,
          has_available_quantity_condition: hasAvailQty.has(r.id),
        };
      }
    }
  } else {
    for (const card of cards) {
      card.offer_state = null;
    }
  }

  return ok({
    cards,
    cardCount: allCards.length,
    productCount: distinctProducts.size,
    offer_rules_by_id: offerRulesById,
  });
}
