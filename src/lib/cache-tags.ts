/**
 * Centralized cache-tag constants for the Next.js + Supabase data layer.
 *
 * Why this file exists:
 *   - The `unstable_cache` + `updateTag` (revalidateTag) pattern relies on
 *     string tags matching between READERS (cached helpers) and WRITERS
 *     (mutation actions). A typo on either side silently breaks
 *     invalidation — the writer thinks it busted the cache, the reader
 *     keeps serving stale data, no error fires.
 *   - One module of `as const` strings lets every site import the same
 *     literal. Adding a new tag is one place to look; renaming one
 *     surfaces every broken caller via TypeScript.
 *
 * Naming convention:
 *   - Singular, lower-kebab, domain-rooted: `catalog-facets`, `currencies`.
 *   - Scoped variants get a `:` suffix: `product:<slug>`. Always build
 *     these via a helper (see `productTag`) so the prefix stays stable.
 *
 * Pre-existing tags ("catalog-facets", "categories") are kept verbatim
 * for backwards-compatibility with the dozens of existing writer sites.
 */

export const CACHE_TAGS = {
  /** Faceted attribute counts for the storefront filter sidebar. */
  CATALOG_FACETS: "catalog-facets",
  /** Top-level category tree for the storefront nav. */
  CATEGORIES: "categories",
  /** Currency FX rates table. Admin-managed, universal. */
  CURRENCIES: "currencies",
  /** Active delivery carriers + custom delivery methods. Admin-managed. */
  COURIERS: "couriers",
} as const;

export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];
