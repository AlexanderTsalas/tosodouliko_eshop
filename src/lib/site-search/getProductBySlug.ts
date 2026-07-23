import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/types/result";
import {
  buildVariantSlugSuffix,
  buildValuesById,
  resolveEffectiveSplitters,
  type ValueLookup,
} from "@/lib/variants-helpers";
import { resolveShowWhenOosForVariants } from "@/lib/storefront/resolveOosVisibility";
import { resolveProductImageUrls } from "@/lib/media/resolveProductImageUrl";
import { evaluateOffersForVariantSet } from "@/lib/offers";
import { getContestableAvailableForVariants } from "@/lib/inventory/getContestableAvailable";
import type { Product, ProductImage, ProductWithRelations } from "@/types/products";
import type { ProductVariant } from "@/types/product-variants";
import type { RuleKind, VariantOfferState } from "@/types/offers";
import type { OfferRuleSummary } from "@/lib/site-search/searchVariants";

export interface ProductBySlugResolution {
  product: ProductWithRelations;
  /** Variant pre-selected by the URL suffix (split-listing), or null for bare product URL. */
  preselectedVariant: ProductVariant | null;
  /**
   * Per-variant offer state. Only contains entries for
   * variants that have an auto-apply discount applied.
   */
  offer_states_by_variant: Record<string, VariantOfferState>;
  /**
   * Rule summaries for badge rendering. Keyed by rule_id; only contains
   * rules referenced by `offer_states_by_variant`.
   */
  offer_rules_by_id: Record<string, OfferRuleSummary>;
}

/**
 * Resolve a storefront slug into a product + optional pre-selected variant.
 *
 *   "vape-x"                  → product alone
 *   "vape-x-strawberry"       → product + variant with splitter Flavour=Strawberry
 *   "vape-x-strawberry-30ml"  → product + variant with two splitters
 *
 * Strategy: longest-prefix match against products.slug. For the matched
 * product, build each variant's splitter-suffix and pick the one matching
 * the URL remainder.
 */
export const getProductBySlug = cache(
  async (slug: string): Promise<Result<ProductBySlugResolution | null>> => {
    const supabase = await createClient();

    // Try the full slug first (handles the no-variant-suffix case fast).
    const productSlugCandidates = expandPrefixes(slug);

    const { data: products, error } = await supabase
      .from("products")
      .select("*")
      .in("slug", productSlugCandidates)
      .eq("active", true);

    if (error) return fail<ProductBySlugResolution | null>(error.message, error.code);
    const matched = (products ?? []) as Product[];
    if (matched.length === 0) return ok(null);

    // Pick the longest matching slug (most specific).
    matched.sort((a, b) => b.slug.length - a.slug.length);
    const product = matched[0];
    const suffix = slug === product.slug ? "" : slug.slice(product.slug.length + 1);

    const productId = product.id;

    const [imgsRes, catsRes, variantsRes, splittersRes] = await Promise.all([
      supabase
        .from("product_images")
        .select("*")
        .eq("product_id", productId)
        .order("display_order"),
      supabase
        .from("product_categories")
        .select("category_id")
        .eq("product_id", productId),
      supabase
        .from("product_variants")
        .select(
          "*, inventory_items(quantity_available, quantity_soft_held, quantity_priority_held)"
        )
        .eq("product_id", productId)
        .eq("is_active", true),
      supabase
        .from("attributes")
        .select("slug, splits_listing"),
    ]);

    const images = await resolveProductImageUrls(
      (imgsRes.data ?? []) as ProductImage[]
    );
    const cats = (catsRes.data ?? []) as { category_id: string }[];
    type InvSnap = {
      quantity_available: number;
      quantity_soft_held: number;
      quantity_priority_held: number;
    };
    type VariantWithInv = ProductVariant & {
      inventory_items: InvSnap | InvSnap[] | null;
    };
    const variantsWithInv = (variantsRes.data ?? []) as VariantWithInv[];

    // Visibility resolution + attribute_value lookup run in parallel.
    // Both depend only on variantsWithInv. Phase 9 of the data-layer
    // remediation — shaves one round-trip off every product detail
    // render. We fetch values for ALL variants (pre-visibility) since
    // attribute_combo is already on the row; cheap extra rows beat an
    // extra sequential round-trip.
    const allVariantIds = variantsWithInv.map((v) => v.id);
    const allValueIdsInUse = new Set<string>();
    for (const v of variantsWithInv) {
      if (!v.attribute_combo) continue;
      for (const id of Object.values(v.attribute_combo)) allValueIdsInUse.add(id);
    }

    const [visibilityById, valuesRowsRes] = await Promise.all([
      resolveShowWhenOosForVariants(supabase, allVariantIds),
      allValueIdsInUse.size > 0
        ? supabase
            .from("attribute_values")
            .select("id, attribute_id, value, slug")
            .in("id", Array.from(allValueIdsInUse))
        : Promise.resolve({ data: null }),
    ]);

    // Visibility filter. "Hidden" = resolved show_when_oos is false AND
    // contestable=0 (no items in flight, fully sold/reserved). Hidden
    // variants are dropped from the returned set and from URL suffix
    // matching. If every variant is hidden, the URL resolves to null
    // (caller will 404).
    function isVariantVisible(v: VariantWithInv): boolean {
      const inv = Array.isArray(v.inventory_items)
        ? v.inventory_items[0]
        : v.inventory_items;
      const contestable =
        Number(inv?.quantity_available ?? 0) +
        Number(inv?.quantity_soft_held ?? 0) +
        Number(inv?.quantity_priority_held ?? 0);
      if (contestable > 0) return true;
      return visibilityById.get(v.id) === true;
    }
    const variants = variantsWithInv.filter(isVariantVisible) as ProductVariant[];

    // If the product has no visible variants at all, the URL is dead.
    if (variants.length === 0) return ok(null);
    const allAttributes = (splittersRes.data ?? []) as Array<{
      slug: string;
      splits_listing: boolean;
    }>;
    const splitterSlugs = resolveEffectiveSplitters(allAttributes, product.split_overrides);

    // Build the value lookup from the rows fetched in parallel above.
    const valuesById = buildValuesById((valuesRowsRes.data ?? []) as ValueLookup[]);

    // Match a variant by reproducing the slug suffix from its attribute_combo.
    let preselectedVariant: ProductVariant | null = null;
    if (suffix.length > 0) {
      for (const v of variants) {
        if (
          buildVariantSlugSuffix(v.attribute_combo, splitterSlugs, valuesById) === suffix
        ) {
          preselectedVariant = v;
          break;
        }
      }
      // If suffix didn't resolve to any variant, treat the URL as not-found
      // rather than silently falling back to the bare product. Prevents stale
      // links from looking valid.
      if (!preselectedVariant) return ok(null);
    }

    // ─── Offers engine ─────────────────────────────────────
    // Evaluate auto-apply offers per variant. The PDP needs this for:
    //   1. Dynamic price label that updates with the variant picker
    //   2. Crossed-out original price next to the effective price
    //   3. The OfferBadge next to the discounted price
    const visibleVariantIds = variants.map((v) => v.id);
    const offerStatesByVariant: Record<string, VariantOfferState> = {};
    const offerRulesById: Record<string, OfferRuleSummary> = {};

    if (visibleVariantIds.length > 0) {
      const stockMap = await getContestableAvailableForVariants(visibleVariantIds);
      const variantContextMap = new Map<
        string,
        { product_id: string; category_ids: string[]; unit_price: number }
      >();
      const productCategoryIds = cats.map((c) => c.category_id);
      for (const v of variants) {
        variantContextMap.set(v.id, {
          product_id: productId,
          category_ids: productCategoryIds,
          unit_price: Number(v.price),
        });
      }

      const evalMap = await evaluateOffersForVariantSet(visibleVariantIds, {
        variantContext: variantContextMap,
        evaluationTime: new Date(),
        currency: "EUR",
        inventoryByVariant: stockMap,
      });

      const referencedRuleIds = new Set<string>();
      for (const [variantId, state] of evalMap) {
        if (
          state.rule_id !== null &&
          state.effective_price < state.original_price
        ) {
          offerStatesByVariant[variantId] = state;
          referencedRuleIds.add(state.rule_id);
        }
      }

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
    }

    return ok({
      product: {
        ...product,
        images,
        categories: cats,
        variants,
      } as ProductWithRelations,
      preselectedVariant,
      offer_states_by_variant: offerStatesByVariant,
      offer_rules_by_id: offerRulesById,
    });
  }
);

/**
 * Given "a-b-c-d", returns ["a-b-c-d", "a-b-c", "a-b", "a"] — the candidate
 * product-slug prefixes in descending specificity.
 */
function expandPrefixes(slug: string): string[] {
  const parts = slug.split("-");
  const out: string[] = [];
  for (let i = parts.length; i >= 1; i--) {
    out.push(parts.slice(0, i).join("-"));
  }
  return out;
}
