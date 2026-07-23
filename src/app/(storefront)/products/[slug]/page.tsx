import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cache, Suspense } from "react";
import { getProductBySlug as _getProductBySlug } from "@/lib/site-search";
import { getActiveCurrency } from "@/lib/multi-currency/getActiveCurrency";
import { getCurrencyRates, convertWithRates } from "@/lib/multi-currency/getCurrencyRates";
import { formatCurrency } from "@/lib/multi-currency/formatCurrency";
import { generateSeoMetadata } from "@/lib/dynamic-seo";
import { getProductSpecifications } from "@/lib/product-specifications/getProductSpecifications";
import { getContestableAvailableForVariants } from "@/lib/inventory/getContestableAvailable";
import { createAdminClient } from "@/lib/supabase/admin";
import ProductDetailInteractive from "@/components/features/products/ProductDetailInteractive";
import ProductSpecsList from "@/components/features/products/ProductSpecsList";
import RelatedProductsCarousels from "@/components/features/related-products/RelatedProductsCarousels";
import { resolveStorefrontFields } from "@/lib/custom-fields/resolveStorefrontFields";
import ProductCustomFieldsForm from "@/components/features/custom-fields/ProductCustomFieldsForm";

export const revalidate = 60;

// React cache() deduplicates getProductBySlug across generateMetadata and
// the page component within the same request — eliminates the double-fetch.
const getProductBySlug = cache((slug: string) => _getProductBySlug(slug));

export async function generateMetadata(
  props: {
    params: Promise<{ slug: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const result = await getProductBySlug(params.slug);
  if (!result.success || !result.data) return {};
  const { product, preselectedVariant } = result.data;

  // Variant-level SEO if this is a split-listing URL, else product SEO.
  if (preselectedVariant) {
    let variantTitleParts = "";
    if (preselectedVariant.attribute_combo) {
      const ids = Object.values(preselectedVariant.attribute_combo);
      if (ids.length > 0) {
        const admin = createAdminClient();
        const { data: vRows } = await admin
          .from("attribute_values")
          .select("id, value")
          .in("id", ids);
        const byId = new Map(
          ((vRows ?? []) as Array<{ id: string; value: string }>).map((r) => [r.id, r.value])
        );
        variantTitleParts = ids
          .map((id) => byId.get(id))
          .filter(Boolean)
          .join(" · ");
      }
    }
    const title = variantTitleParts
      ? `${product.name} — ${variantTitleParts}`
      : product.name;
    return generateSeoMetadata("product_variant", preselectedVariant.id, {
      title,
      description: product.description ?? undefined,
    });
  }

  return generateSeoMetadata("product", product.id, {
    title: product.name,
    description: product.description ?? undefined,
  });
}

export default async function ProductPage(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ debug_related?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const result = await getProductBySlug(params.slug);
  if (!result.success || !result.data) notFound();

  const {
    product,
    preselectedVariant,
    offer_states_by_variant: offerStatesByVariant,
    offer_rules_by_id: offerRulesById,
  } = result.data;

  // All post-product queries are independent — run in parallel. This
  // replaces 5 sequential queries (~300ms) with 1 parallel batch (~60ms).
  const activeCurrency = await getActiveCurrency();
  const needsConversion = activeCurrency !== product.currency;
  const variantIds = (product.variants ?? []).map((v) => v.id);
  const valueIdsInUse = new Set<string>();
  const slugsInUse = new Set<string>();
  for (const v of product.variants ?? []) {
    if (!v.attribute_combo) continue;
    for (const [slug, valueId] of Object.entries(v.attribute_combo)) {
      slugsInUse.add(slug);
      valueIdsInUse.add(valueId);
    }
  }

  const admin = createAdminClient();
  const [
    rates,
    specs,
    contestableAvailable,
    { data: attrRows },
    { data: valueRows },
    storefrontFields,
  ] = await Promise.all([
      needsConversion ? getCurrencyRates() : Promise.resolve(null),
      getProductSpecifications(product.id),
      getContestableAvailableForVariants(variantIds),
      slugsInUse.size > 0
        ? admin
            .from("attributes")
            .select("slug, name")
            .in("slug", Array.from(slugsInUse))
        : Promise.resolve({ data: [] as Array<{ slug: string; name: string }> }),
      valueIdsInUse.size > 0
        ? admin
            .from("attribute_values")
            .select("id, value, display_order")
            .in("id", Array.from(valueIdsInUse))
        : Promise.resolve({
            data: [] as Array<{ id: string; value: string; display_order: number }>,
          }),
      resolveStorefrontFields({
        product_id: product.id,
        variant_id: preselectedVariant?.id ?? null,
      }),
    ]);

  const convert = (amount: number) =>
    rates ? convertWithRates(amount, product.currency, activeCurrency, rates) : amount;

  const basePriceLabel = formatCurrency(convert(Number(product.base_price)), activeCurrency);
  const variantPriceLabels: Record<string, string> = {};
  // Original-price labels for crossed-out display. Only set
  // for variants where an auto-apply offer reduces the price.
  const variantOriginalPriceLabels: Record<string, string> = {};
  for (const v of product.variants ?? []) {
    const offerState = offerStatesByVariant[v.id];
    if (offerState && offerState.effective_price < offerState.original_price) {
      // Apply the discount to the FORMATTED-CURRENCY value chain so the
      // displayed price respects active currency conversion.
      variantPriceLabels[v.id] = formatCurrency(
        convert(offerState.effective_price),
        activeCurrency
      );
      variantOriginalPriceLabels[v.id] = formatCurrency(
        convert(offerState.original_price),
        activeCurrency
      );
    } else {
      variantPriceLabels[v.id] = formatCurrency(
        convert(Number(v.price)),
        activeCurrency
      );
    }
  }

  const effectiveAvailableByVariant: Record<string, number> = {};
  for (const [id, n] of contestableAvailable.entries()) {
    effectiveAvailableByVariant[id] = n;
  }

  const attributeNames: Record<string, string> = {};
  for (const a of (attrRows ?? []) as Array<{ slug: string; name: string }>) {
    attributeNames[a.slug] = a.name;
  }
  const valuesById: Record<string, { id: string; value: string; display_order: number }> = {};
  for (const v of (valueRows ?? []) as Array<{
    id: string;
    value: string;
    display_order: number;
  }>) {
    valuesById[v.id] = v;
  }

  return (
    <main className="container mx-auto px-4 py-6 grid grid-cols-1 md:grid-cols-2 gap-8 content-reveal">
      <ProductDetailInteractive
        productId={product.id}
        productName={product.name}
        images={product.images}
        imageAxes={product.image_axes ?? []}
        variants={product.variants ?? []}
        variantPriceLabels={variantPriceLabels}
        variantOriginalPriceLabels={variantOriginalPriceLabels}
        offerStatesByVariant={offerStatesByVariant}
        offerRulesById={offerRulesById}
        basePriceLabel={basePriceLabel}
        initialVariantId={preselectedVariant?.id ?? null}
        effectiveAvailableByVariant={effectiveAvailableByVariant}
        attributeNames={attributeNames}
        valuesById={valuesById}
        activeCurrency={activeCurrency}
        customFieldsSlot={
          storefrontFields && storefrontFields.length > 0 ? (
            <ProductCustomFieldsForm
              fields={storefrontFields}
              base_price={convert(
                Number(
                  preselectedVariant
                    ? preselectedVariant.price
                    : product.base_price
                )
              )}
              currency_code={activeCurrency}
            />
          ) : null
        }
      />
      <div className="md:col-span-2 space-y-4">
        {product.description && (
          <p className="mt-4 text-muted-foreground whitespace-pre-line">
            {product.description}
          </p>
        )}
        <ProductSpecsList specs={specs} />
      </div>
      {/* Related Products carousels — server-rendered: hits the
          resolver at request time and bulk-loads the surfaced
          products' images + prices. Wrapped in <Suspense> so it
          streams in AFTER the main product card has already painted,
          instead of blocking the entire page on resolver + bulk-image
          fetches. The empty fallback is deliberate: when the
          resolver returns nothing, the carousel renders nothing too,
          and a flickering placeholder would look broken. */}
      <Suspense fallback={<RelatedProductsCarouselsSkeleton />}>
        <RelatedProductsCarousels
          product_id={product.id}
          variant_id={preselectedVariant?.id ?? null}
          debug={searchParams.debug_related === "1"}
        />
      </Suspense>
    </main>
  );
}

function RelatedProductsCarouselsSkeleton() {
  return (
    <div className="md:col-span-2 space-y-8 mt-8 animate-pulse">
      <div className="h-6 w-48 bg-muted/40 rounded mb-3" />
      <div className="flex gap-4 overflow-hidden pb-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="storefront-product-card border rounded p-3 bg-card/50"
          >
            <div className="w-full aspect-square bg-muted rounded" />
            <div className="h-4 w-3/4 bg-muted/60 rounded mt-2" />
            <div className="h-4 w-1/3 bg-muted/40 rounded mt-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
