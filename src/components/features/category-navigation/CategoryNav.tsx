import Link from "next/link";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Category } from "@/types/category-navigation";
import { strings } from "@/config/strings";

/**
 * Fetches active top-level categories. Cached for 24 hours — categories
 * change rarely (added/edited maybe 1-2x per month). The cache is tagged
 * so admin actions that modify categories can bust it with
 * updateTag("categories").
 *
 * Uses the admin client (not the request-scoped client) so the function
 * works inside unstable_cache, which may run outside request context on
 * cache revalidation.
 */
const getTopLevelCategories = unstable_cache(
  async () => {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("categories")
      .select("*")
      .eq("active", true)
      .is("parent_id", null)
      .order("display_order");
    if (error || !data) return [];
    return data as Category[];
  },
  ["top-level-categories"],
  { revalidate: 86400, tags: ["categories"] }
);

/**
 * Server component. Lists active top-level categories (parent_id IS NULL).
 */
export default async function CategoryNav() {
  const categories = await getTopLevelCategories();
  if (categories.length === 0) return null;

  return (
    <nav aria-label={strings.categories.navAriaLabel} className="flex flex-wrap gap-3">
      {categories.map((c) => (
        <Link
          key={c.id}
          href={`/products?category=${c.slug}`}
          className="text-sm hover:underline"
        >
          {c.name}
        </Link>
      ))}
    </nav>
  );
}
