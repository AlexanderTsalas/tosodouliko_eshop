import Link from "next/link";
import { searchVariants, getCatalogFacets } from "@/lib/site-search";
import { getCategoryTree } from "@/lib/categories/getCategoryTree";
import type { CategoryTreeNode } from "@/types/category-navigation";
import StorefrontProductCard from "@/components/features/products/StorefrontProductCard";
import FilterSidebar from "@/components/features/catalog/FilterSidebar";
import MobileFilters from "@/components/features/catalog/MobileFilters";
import MasonryGrid from "@/components/features/catalog/MasonryGrid";
import SortSelect from "@/components/features/catalog/SortSelect";
import Pagination from "@/components/admin/common/Pagination";

const ALLOWED_SORTS = ["newest", "price_asc", "price_desc", "name"] as const;
type SortKey = (typeof ALLOWED_SORTS)[number];
import { strings } from "@/config/strings";

/** Find a category's display name by slug, walking an already-fetched tree. */
function findCategoryName(tree: CategoryTreeNode[], slug: string | undefined): string | null {
  if (!slug) return null;
  const stack: CategoryTreeNode[] = [...tree];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.slug === slug) return node.name;
    stack.push(...node.children);
  }
  return null;
}

export const metadata = {
  title: strings.products.pageTitle,
};
export const revalidate = 60;

const ALLOWED_PAGE_SIZES = [12, 24, 48, 96];
const DEFAULT_PAGE_SIZE = 24;

export default async function ProductsPage(
  props: {
    searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
  }
) {
  const searchParams = await props.searchParams;
  const q = typeof searchParams.q === "string" ? searchParams.q : undefined;
  const categorySlug = typeof searchParams.category === "string" ? searchParams.category : undefined;
  const minPrice = typeof searchParams.minPrice === "string" ? Number(searchParams.minPrice) : undefined;
  const maxPrice = typeof searchParams.maxPrice === "string" ? Number(searchParams.maxPrice) : undefined;
  const ageMin = typeof searchParams.ageMin === "string" ? Number(searchParams.ageMin) : undefined;
  const ageMax = typeof searchParams.ageMax === "string" ? Number(searchParams.ageMax) : undefined;

  const sortRaw = typeof searchParams.sort === "string" ? searchParams.sort : undefined;
  const sort: SortKey | undefined = ALLOWED_SORTS.includes(sortRaw as SortKey)
    ? (sortRaw as SortKey)
    : undefined;

  const pageRaw = typeof searchParams.page === "string" ? Number(searchParams.page) : 1;
  const page = Math.max(1, Number.isFinite(pageRaw) ? pageRaw : 1);
  const pageSizeRaw =
    typeof searchParams.pageSize === "string" ? Number(searchParams.pageSize) : DEFAULT_PAGE_SIZE;
  const pageSize = ALLOWED_PAGE_SIZES.includes(pageSizeRaw) ? pageSizeRaw : DEFAULT_PAGE_SIZE;

  // Parse attribute filters: any non-reserved query param is treated as an
  // attribute slug whose values are kept (multi-value supported via repeated params).
  const reservedKeys = new Set([
    "q",
    "category",
    "minPrice",
    "maxPrice",
    "ageMin",
    "ageMax",
    "page",
    "pageSize",
  ]);
  const attributeFilters: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(searchParams)) {
    if (reservedKeys.has(k) || v === undefined) continue;
    attributeFilters[k] = Array.isArray(v) ? v : [v];
  }

  const [result, facetsResult, categoryTree] = await Promise.all([
    searchVariants({
      q,
      categorySlug,
      minPrice: Number.isFinite(minPrice) ? minPrice : undefined,
      maxPrice: Number.isFinite(maxPrice) ? maxPrice : undefined,
      ageMin: Number.isFinite(ageMin) ? ageMin : undefined,
      ageMax: Number.isFinite(ageMax) ? ageMax : undefined,
      attributeFilters: Object.keys(attributeFilters).length > 0 ? attributeFilters : undefined,
      sort,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    // Facets are scoped to the selected category. With no category chosen
    // ("Όλες οι κατηγορίες"), getCatalogFacets() returns the full global facet
    // set so every filter is available.
    getCatalogFacets(categorySlug),
    getCategoryTree(),
  ]);
  const categoryName = findCategoryName(categoryTree, categorySlug);

  // Build preserve-params for Pagination, including the multi-valued attribute filters.
  // URLSearchParams handles repeated keys naturally; Pagination's interface
  // is Record<string,string> so we flatten by joining multi-values with commas
  // and re-split in the FilterSidebar. For pagination URLs the simple
  // first-value flatten suffices because they're built off URLSearchParams.toString().
  const preserveParams: Record<string, string> = {};
  if (q) preserveParams.q = q;
  if (categorySlug) preserveParams.category = categorySlug;
  if (Number.isFinite(minPrice)) preserveParams.minPrice = String(minPrice);
  if (Number.isFinite(maxPrice)) preserveParams.maxPrice = String(maxPrice);
  if (Number.isFinite(ageMin)) preserveParams.ageMin = String(ageMin);
  if (Number.isFinite(ageMax)) preserveParams.ageMax = String(ageMax);
  if (sort) preserveParams.sort = sort;
  for (const [k, vals] of Object.entries(attributeFilters)) {
    // Only preserve the first value — for multi-value attribute filters,
    // pagination URLs lose the extras. Acceptable for v1; full preservation
    // needs Pagination to support repeated keys.
    if (vals.length > 0) preserveParams[k] = vals[0];
  }

  return (
    <main className="mx-auto w-full max-w-[1600px] grid grid-cols-1 md:grid-cols-[240px_1fr] gap-8 px-4 lg:px-8 py-6">
      <aside className="hidden md:block sticky top-24 self-start max-h-[calc(100vh-7rem)] overflow-y-auto pr-1">
        <FilterSidebar
          facets={facetsResult.success ? facetsResult.data.facets : []}
          activeAttributeFilters={attributeFilters}
          categories={categoryTree}
          activeCategory={categorySlug}
        />
      </aside>
      <section>
        {/* Breadcrumb */}
        <nav
          aria-label="breadcrumb"
          className="mb-3 flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-stone-taupe"
        >
          <Link href="/" className="hover:text-terracotta transition-colors">
            {strings.layout.nav.home}
          </Link>
          <span className="text-stone-taupe/50">/</span>
          <span className="text-ink">{categoryName ?? strings.products.pageTitle}</span>
        </nav>

        <div className="pb-4 mb-6 border-b border-stone-taupe/20 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="font-serif text-3xl font-bold tracking-tight text-ink">
              {categoryName ?? strings.products.pageTitle}
            </h1>
            {result.success && (
              <p className="mt-1 text-sm text-muted-foreground">
                {(result.data.cardCount === 1
                  ? strings.products.cardCountSingular
                  : strings.products.cardCount
                ).replace("{count}", String(result.data.cardCount))}{" "}
                ·{" "}
                {(result.data.productCount === 1
                  ? strings.products.productCountSingular
                  : strings.products.productCount
                ).replace("{count}", String(result.data.productCount))}
              </p>
            )}
          </div>
          <SortSelect />
        </div>

        <MobileFilters
          facets={facetsResult.success ? facetsResult.data.facets : []}
          activeAttributeFilters={attributeFilters}
          categories={categoryTree}
          activeCategory={categorySlug}
        />

        {!result.success && (
          <p className="text-destructive">{strings.products.error.replace("{error}", result.error)}</p>
        )}
        {result.success && result.data.cards.length === 0 && (
          <div className="border border-dashed border-stone-taupe/40 rounded-sm bg-warm-sand/20 px-6 py-12 text-center text-sm text-stone-taupe">
            {strings.products.notFound}
          </div>
        )}
        {result.success && result.data.cards.length > 0 && (
          // Two-axis masonry of polaroid-style "photo" cards — varied heights
          // (measured row-span) and varied widths (some cards span 2 columns),
          // with card widths bounded to 0.8×–1.8× of the normal size.
          <MasonryGrid>
            {result.data.cards.map((card, cardIndex) => (
              <StorefrontProductCard
                key={card.cardKey}
                card={card}
                offerRulesById={result.data.offer_rules_by_id}
                priorityImage={cardIndex < 8}
                layout="masonry"
              />
            ))}
          </MasonryGrid>
        )}

        {result.success && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={result.data.cardCount}
            preserveParams={preserveParams}
            pageSizeOptions={ALLOWED_PAGE_SIZES}
          />
        )}
      </section>
    </main>
  );
}
