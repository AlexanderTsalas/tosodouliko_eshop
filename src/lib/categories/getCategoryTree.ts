import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Category, CategoryTreeNode } from "@/types/category-navigation";

/**
 * Builds a nested category tree from a flat list. Roots are nodes whose
 * parent_id is null OR whose parent isn't present in the active set (an
 * inactive parent shouldn't orphan its visible children off the menu).
 * Sibling order follows the incoming display_order ordering.
 */
function buildTree(cats: Category[]): CategoryTreeNode[] {
  const byId = new Map<string, CategoryTreeNode>();
  for (const c of cats) byId.set(c.id, { ...c, children: [] });

  const roots: CategoryTreeNode[] = [];
  for (const c of cats) {
    const node = byId.get(c.id)!;
    const parent = c.parent_id ? byId.get(c.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/**
 * Fetches the full active category tree for the storefront mega-nav.
 * Cached 24h and tagged "categories" — the same tag the admin category
 * actions already bust via updateTag("categories"), so edits flow through
 * automatically. Uses the admin client because unstable_cache may run
 * outside request context on revalidation.
 */
export const getCategoryTree = unstable_cache(
  async (): Promise<CategoryTreeNode[]> => {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("categories")
      .select("*")
      .eq("active", true)
      .order("display_order");
    if (error || !data) return [];
    return buildTree(data as Category[]);
  },
  ["category-tree"],
  { revalidate: 86400, tags: ["categories"] }
);
