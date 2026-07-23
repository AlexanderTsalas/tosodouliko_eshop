import { searchVariants, type CatalogCard, type OfferRuleSummary } from "@/lib/site-search";
import StorefrontProductCard from "@/components/features/products/StorefrontProductCard";
import CarouselRow from "@/components/features/related-products/CarouselRow";
import MaskIcon from "@/components/layout/MaskIcon";
import {
  loadResolverData,
  buildViewerFromProduct,
  resolveRelatedProducts,
} from "@/lib/related-products";
import { viewerMatchesSide } from "@/lib/related-products/matchSide";
import { resolveTargetCandidates } from "@/lib/related-products/resolveTarget";

const FALLBACK_TITLE = "Προτεινόμενα";

interface Props {
  product_id: string;
  variant_id?: string | null;
  /** When true (driven by `?debug_related=1`), render a diagnostic
   *  panel below the carousels listing every active association and
   *  the exact step where it was kept or skipped. Dev tool — no
   *  permission gate, but the URL flag means it never shows up by
   *  accident. */
  debug?: boolean;
}

/**
 * Storefront — renders up to 3 carousels of recommended products under
 * the main product details. Server component; runs on every render
 * (the page is `revalidate = 60` so this is cached at the page level).
 *
 * Pipeline:
 *   1. Load resolver dataset (associations + product index + inventory)
 *   2. Build viewer for this product (+ variant if available)
 *   3. Resolve carousels (engine enforces hard cap of 3 + self-exclusion)
 *   4. Bulk-fetch the surfaced products' slugs, primary images, prices
 *   5. Render carousels — each is a horizontally-scrollable strip of
 *      product cards. Carousel renders nothing if the engine returned
 *      zero matches.
 */
export default async function RelatedProductsCarousels({
  product_id,
  variant_id,
  debug = false,
}: Props) {
  const dataset = await loadResolverData();
  const viewer = buildViewerFromProduct(dataset, {
    product_id,
    variant_id: variant_id ?? null,
  });
  if (!viewer) {
    if (debug) {
      return (
        <div className="md:col-span-2 mt-8">
          <DebugPanel
            rows={[
              {
                name: "(viewer)",
                reason: `buildViewerFromProduct returned null — product ${product_id} not found in active products. Is the product active?`,
              },
            ]}
          />
        </div>
      );
    }
    return null;
  }

  const { carousels } = resolveRelatedProducts({ viewer, dataset });

  // Build debug trace once so we can render the panel even when carousels
  // produced output (the panel always lists all active associations).
  const debugRows = debug
    ? dataset.associations.map((a) => {
        if (!a.active) {
          return { name: a.name, reason: "active = false (skipped)" };
        }
        if (!viewerMatchesSide(viewer, a.source_groups, dataset.productsById)) {
          return {
            name: a.name,
            reason: `source filter did NOT match this product (viewer.category_ids=[${viewer.category_ids.join(
              ", "
            )}], variant_id=${viewer.variant_id ?? "—"})`,
          };
        }
        let candidates = resolveTargetCandidates(
          a.target_groups,
          dataset.productsList
        );
        const candidatesAfterTarget = candidates.length;
        candidates = candidates.filter((id) => id !== viewer.product_id);
        const afterSelf = candidates.length;
        if (a.exclude_oos) {
          candidates = candidates.filter((id) => {
            const p = dataset.productsById.get(id);
            return p ? p.variants.some((v) => v.quantity_available > 0) : false;
          });
        }
        const afterOos = candidates.length;
        if (candidatesAfterTarget === 0) {
          // Break down per-group + per-condition to expose which
          // condition is killing the candidate set. The admin's
          // Δοκιμή drawer reuses the same productsList (loaded with
          // `products.active = true` + `product_variants.is_active = true`),
          // so if it surfaced matches but the storefront doesn't, the
          // most likely cause is that the matched products / variants
          // got deactivated between admin test and storefront view.
          const groupBreakdown = a.target_groups.map((g, gi) => {
            if (g.conditions.length === 0) {
              return `  • Group ${gi + 1}: (no conditions — group ignored)`;
            }
            const perCond = g.conditions
              .map((c) => {
                const matchCount = dataset.productsList.filter((p) => {
                  const raw = singleConditionMatches(c, p);
                  return c.negate ? !raw : raw;
                }).length;
                return `${c.kind}${c.negate ? "(negated)" : ""}=${matchCount}`;
              })
              .join(", ");
            const groupHits = dataset.productsList.filter((p) =>
              g.conditions.every((c) => {
                const raw = singleConditionMatches(c, p);
                return c.negate ? !raw : raw;
              })
            ).length;
            return `  • Group ${gi + 1} (AND): { ${perCond} } → ${groupHits} product(s) pass ALL`;
          });

          // Deep dump for attribute_value conditions: show the saved
          // config + a sample of what variants actually hold for that
          // attribute. This is the only way to see whether the value
          // the admin saved matches anything that exists in
          // product_variants.attribute_combo.
          const deepDump: string[] = [];
          for (const g of a.target_groups) {
            for (const c of g.conditions) {
              if (c.kind === "attribute_value" || c.kind === "attribute_value_in") {
                const cfg = c.config as Record<string, unknown>;
                deepDump.push(
                  `    saved config (${c.kind}): ${JSON.stringify(cfg)}`
                );
                const attrId = cfg.attribute_id as string | undefined;
                if (attrId) {
                  // Count distinct attribute_value ids actually present
                  // in active variants for this attribute_id, AND in
                  // product_specifications (the engine now matches both).
                  const seenInVariants = new Set<string>();
                  let variantsWithThisAttr = 0;
                  const seenInSpecs = new Set<string>();
                  let productsWithThisSpec = 0;
                  for (const p of dataset.productsList) {
                    for (const v of p.variants) {
                      if (attrId in v.attributes) {
                        variantsWithThisAttr++;
                        seenInVariants.add(v.attributes[attrId]);
                      }
                    }
                    if (attrId in p.spec_attributes) {
                      productsWithThisSpec++;
                      seenInSpecs.add(p.spec_attributes[attrId]);
                    }
                  }
                  deepDump.push(
                    `    → variant axis: ${variantsWithThisAttr} active variant(s) carry attribute_id=${attrId}`
                  );
                  deepDump.push(
                    `    → distinct value UUIDs in variant_combo: [${Array.from(
                      seenInVariants
                    ).join(", ") || "(none)"}]`
                  );
                  deepDump.push(
                    `    → product spec: ${productsWithThisSpec} active product(s) have this attribute as a spec`
                  );
                  deepDump.push(
                    `    → distinct value UUIDs in product_specifications: [${Array.from(
                      seenInSpecs
                    ).join(", ") || "(none)"}]`
                  );
                  if (
                    productsWithThisSpec === 0 &&
                    variantsWithThisAttr === 0
                  ) {
                    deepDump.push(
                      `    → ⚠ this attribute isn't attached to ANY product. Create it on a variants tab (axis) or specs panel before associations referencing it can match.`
                    );
                  }
                  const lookFor = (
                    c.kind === "attribute_value"
                      ? [cfg.value as string]
                      : ((cfg.values as string[]) ?? [])
                  ).filter(Boolean);
                  deepDump.push(
                    `    → condition expects: [${lookFor.join(", ") || "(empty)"}]`
                  );
                  const variantIntersections = lookFor.filter((v) =>
                    seenInVariants.has(v)
                  );
                  const specIntersections = lookFor.filter((v) =>
                    seenInSpecs.has(v)
                  );
                  if (variantIntersections.length > 0) {
                    deepDump.push(
                      `    → ✓ variant-axis intersection: [${variantIntersections.join(", ")}]`
                    );
                  }
                  if (specIntersections.length > 0) {
                    deepDump.push(
                      `    → ✓ product-spec intersection: [${specIntersections.join(", ")}]`
                    );
                  }
                  if (
                    variantIntersections.length === 0 &&
                    specIntersections.length === 0
                  ) {
                    deepDump.push(
                      `    → ✗ no intersection — the saved value(s) don't appear in any active variant's attribute_combo OR in any product_specifications row`
                    );
                  }
                }
              }
            }
          }
          return {
            name: a.name,
            reason: `target filter returned 0 candidates. Active products in dataset: ${dataset.productsList.length}. Per-group breakdown:\n${groupBreakdown.join(
              "\n"
            )}${
              deepDump.length > 0 ? "\nAttribute-value diagnostics:\n" + deepDump.join("\n") : ""
            }\nHint: dataset only includes products.active=true with variants.is_active=true. If those got deactivated since you tested in the admin, they vanish from the storefront resolver.`,
          };
        }
        if (afterSelf === 0) {
          return {
            name: a.name,
            reason: `${candidatesAfterTarget} candidates → 0 after self-exclusion (only the source product itself matched)`,
          };
        }
        if (afterOos === 0) {
          return {
            name: a.name,
            reason: `${afterSelf} candidates → 0 after OOS filter (exclude_oos=true and no candidate has inventory_items.quantity_available > 0)`,
          };
        }
        return {
          name: a.name,
          reason: `OK — ${afterOos} candidate(s) reached carousel rendering`,
        };
      })
    : [];

  if (carousels.length === 0) {
    if (debug) {
      return (
        <div className="md:col-span-2 mt-8">
          <DebugPanel rows={debugRows} />
        </div>
      );
    }
    return null;
  }

  // Defer all the variant fan-out / image resolution / offer
  // evaluation to `searchVariants` — the same data path the catalog
  // page uses. One function, one set of rules, one card layout.
  // Without this pivot the carousel had to reimplement image URL
  // resolution (and got it wrong, leaving images blank).
  const allProductIds = Array.from(
    new Set(carousels.flatMap((c) => c.products.map((p) => p.id)))
  );
  const searchRes = await searchVariants({
    productIds: allProductIds,
    limit: 200,
  });
  const allCards: CatalogCard[] = searchRes.success ? searchRes.data.cards : [];
  const offerRulesById: Record<string, OfferRuleSummary> = searchRes.success
    ? searchRes.data.offer_rules_by_id
    : {};

  // Bucket cards by product so each carousel can grab the cards for
  // the products its resolver picked. For card_granularity="product",
  // collapse to ONE card per product (preserves the legacy "one tile
  // per product" feel); for "variant", every split-listing card
  // surfaces so a customer browsing "blue shoes" sees the blue tiles
  // separately from any other variant of the same product.
  const cardsByProduct = new Map<string, CatalogCard[]>();
  for (const c of allCards) {
    const list = cardsByProduct.get(c.product.id) ?? [];
    list.push(c);
    cardsByProduct.set(c.product.id, list);
  }

  // Map association_id → full association so the render loop can
  // look up target_groups to filter variant cards.
  const associationById = new Map(
    dataset.associations.map((a) => [a.id, a])
  );

  return (
    <div className="md:col-span-2 space-y-10 mt-16 pt-8 border-t border-stone-taupe/20">
      {debug && <DebugPanel rows={debugRows} />}
      {carousels.map((carousel) => {
        const title =
          carousel.title_translations.el ??
          carousel.title_translations.en ??
          FALLBACK_TITLE;
        const association = associationById.get(carousel.association_id);
        const cards: CatalogCard[] = [];
        for (const p of carousel.products) {
          const productCards = cardsByProduct.get(p.id) ?? [];
          if (productCards.length === 0) continue;
          if (carousel.card_granularity === "product") {
            cards.push(productCards[0]);
          } else {
            // Variant granularity: keep only variant cards whose
            // attribute_combo actually satisfies at least one target
            // group's variant-level conditions. Without this filter,
            // matching ONE blue-variant on a product would surface
            // every color of that product (the user's complaint).
            const datasetProduct = dataset.productsById.get(p.id);
            const filtered = association
              ? productCards.filter((card) => {
                  const datasetVariant = datasetProduct?.variants.find(
                    (v) => v.id === card.variant.id
                  );
                  if (!datasetVariant || !datasetProduct) return false;
                  return association.target_groups.some((g) =>
                    variantPassesGroup(
                      card.variant.id,
                      datasetVariant.attributes,
                      datasetProduct.spec_attributes,
                      g
                    )
                  );
                })
              : productCards;
            cards.push(...filtered);
          }
        }
        if (cards.length === 0) return null;
        return (
          <RelatedCarousel
            key={carousel.association_id}
            title={title}
            cards={cards}
            offerRulesById={offerRulesById}
          />
        );
      })}
    </div>
  );
}

// ─── Per-condition diagnostic helper ────────────────────────────────

/**
 * Mirrors `resolveTarget.ts`'s `evaluateRaw` — kept inline here so the
 * debug breakdown can count matches per condition without exporting
 * resolver internals (which would invite admin code to depend on them).
 * Stays in sync by being a focused, small switch matching the same
 * union shape.
 */
function singleConditionMatches(
  c: import("@/types/related-products").RelatedProductsFilterCondition,
  p: import("@/lib/related-products/types").ResolverProductData
): boolean {
  switch (c.kind) {
    case "category":
      return p.category_ids.includes(
        (c.config as { category_id: string }).category_id
      );
    case "product":
      return p.id === (c.config as { product_id: string }).product_id;
    case "variant":
      return p.variants.some(
        (v) => v.id === (c.config as { variant_id: string }).variant_id
      );
    case "attribute_value": {
      const cfg = c.config as { attribute_id: string; value: string };
      if (
        p.variants.some(
          (v) => v.attributes[cfg.attribute_id] === cfg.value
        )
      ) {
        return true;
      }
      return p.spec_attributes[cfg.attribute_id] === cfg.value;
    }
    case "attribute_value_in": {
      const cfg = c.config as { attribute_id: string; values: string[] };
      const set = new Set(cfg.values);
      if (
        p.variants.some((v) => {
          const val = v.attributes[cfg.attribute_id];
          return val !== undefined && set.has(val);
        })
      ) {
        return true;
      }
      const specVal = p.spec_attributes[cfg.attribute_id];
      return specVal !== undefined && set.has(specVal);
    }
    case "attribute_present": {
      const cfg = c.config as { attribute_id: string };
      if (p.variants.some((v) => cfg.attribute_id in v.attributes)) {
        return true;
      }
      return cfg.attribute_id in p.spec_attributes;
    }
    case "tag":
      return false;
  }
}

// ─── Variant-level group match (for `card_granularity = variant`) ────

/**
 * Returns true when a single variant satisfies every variant-level
 * condition in a target group. Product-level conditions (category,
 * product, tag) always pass at this stage — the product they belong
 * to has already been admitted by the resolver. This is what lets a
 * "blue shoes" association surface ONLY the blue variant cards
 * instead of every color of every matched product.
 *
 * `variantAttrs` MUST be UUID-keyed (i.e. taken from the loader's
 * dataset, not directly from `product_variants.attribute_combo`,
 * which is slug-keyed).
 *
 * `specAttrs` are the OWNING PRODUCT's product-level specs (same
 * UUID-keyed shape, set once per product). attribute_value conditions
 * fall back to specs when no variant axis carries the attribute — a
 * spec is product-level so EVERY variant of the product passes that
 * condition. This is what lets a "leather shoes" association with the
 * spec attribute `Τύπος Υφάσματος = Δέρμα` surface every variant card
 * of every product whose spec matches, even though no variant's
 * attribute_combo contains that attribute.
 */
function variantPassesGroup(
  variantId: string,
  variantAttrs: Record<string, string>,
  specAttrs: Record<string, string>,
  group: import("@/types/related-products").RelatedProductsFilterGroupWithConditions
): boolean {
  return group.conditions.every((c) => {
    const raw = (() => {
      switch (c.kind) {
        case "category":
        case "product":
        case "tag":
          return true;
        case "variant":
          return variantId === (c.config as { variant_id: string }).variant_id;
        case "attribute_value": {
          const cfg = c.config as { attribute_id: string; value: string };
          if (variantAttrs[cfg.attribute_id] === cfg.value) return true;
          return specAttrs[cfg.attribute_id] === cfg.value;
        }
        case "attribute_value_in": {
          const cfg = c.config as {
            attribute_id: string;
            values: string[];
          };
          const seen = variantAttrs[cfg.attribute_id];
          if (seen !== undefined && cfg.values.includes(seen)) return true;
          const specSeen = specAttrs[cfg.attribute_id];
          return specSeen !== undefined && cfg.values.includes(specSeen);
        }
        case "attribute_present": {
          const cfg = c.config as { attribute_id: string };
          if (cfg.attribute_id in variantAttrs) return true;
          return cfg.attribute_id in specAttrs;
        }
      }
    })();
    return c.negate ? !raw : raw;
  });
}

// ─── Diagnostic panel (?debug_related=1) ────────────────────────────

function DebugPanel({
  rows,
}: {
  rows: Array<{ name: string; reason: string }>;
}) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
      <p className="font-semibold mb-2 text-amber-900">
        Related Products — Debug ({rows.length} active association
        {rows.length === 1 ? "" : "s"})
      </p>
      {rows.length === 0 ? (
        <p className="text-amber-800">
          Δεν υπάρχουν ενεργές συσχετίσεις στον πίνακα
          related_products_associations.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r, i) => (
            <li key={i} className="text-amber-900">
              <div className="font-mono text-xs bg-amber-100 px-1.5 py-0.5 rounded inline-block mb-1">
                {r.name}
              </div>
              <pre className="whitespace-pre-wrap text-xs font-sans leading-snug">
                {r.reason}
              </pre>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-amber-700 mt-3">
        Remove <code>?debug_related=1</code> from the URL to hide this panel.
      </p>
    </div>
  );
}

// ─── Carousel UI (server-rendered, horizontal scroll) ───────────────

function RelatedCarousel({
  title,
  cards,
  offerRulesById,
}: {
  title: string;
  cards: CatalogCard[];
  offerRulesById: Record<string, OfferRuleSummary>;
}) {
  return (
    <section aria-label={title}>
      <h2 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-ink px-1">
        {title}
      </h2>
      <span className="block w-16 h-0.5 bg-gradient-to-r from-transparent via-terracotta to-transparent mt-2 mb-8 ml-1" />
      {/* Suggestion hedgehog sits to the left; the carousel is pushed right to
          make room for it (hidden on small screens to keep the row usable).
          The cards keep their own width via the `.storefront-product-card`
          rule in globals.css. */}
      <div className="flex items-center gap-5 lg:gap-7">
        <MaskIcon
          src="/icons_svgs/suggestion_hedgehog.svg"
          className="hidden lg:block w-96 h-[243px] shrink-0 text-[#6b4f37]"
        />
        <div className="flex-1 min-w-0">
          <CarouselRow>
            {cards.map((card) => (
              <StorefrontProductCard
                key={card.cardKey}
                card={card}
                offerRulesById={offerRulesById}
              />
            ))}
          </CarouselRow>
        </div>
      </div>
    </section>
  );
}
