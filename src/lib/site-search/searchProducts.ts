import { createClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/types/result";
import type { Product } from "@/types/products";

export interface SearchProductsInput {
  q?: string;
  categorySlug?: string;
  minPrice?: number;
  maxPrice?: number;
  ageMin?: number;
  ageMax?: number;
  limit?: number;
  offset?: number;
}

export interface SearchProductsResult {
  items: Product[];
  total: number;
}

/**
 * Search products by free-text + faceted filters. Uses ilike for now —
 * upgrade to FTS (`tsvector`) when search relevance matters.
 *
 * Only returns active products.
 */
export async function searchProducts(
  input: SearchProductsInput = {}
): Promise<Result<SearchProductsResult>> {
  const supabase = await createClient();

  const limit = Math.min(input.limit ?? 24, 100);
  const offset = Math.max(input.offset ?? 0, 0);

  let query = supabase
    .from("products")
    .select("*", { count: "exact" })
    .eq("active", true);

  if (input.q && input.q.trim()) {
    const term = `%${input.q.trim().replace(/[%_]/g, "\\$&")}%`;
    query = query.or(`name.ilike.${term},description.ilike.${term},brand.ilike.${term}`);
  }

  if (typeof input.minPrice === "number") {
    query = query.gte("base_price", input.minPrice);
  }
  if (typeof input.maxPrice === "number") {
    query = query.lte("base_price", input.maxPrice);
  }
  if (typeof input.ageMin === "number") {
    query = query.gte("age_min", input.ageMin);
  }
  if (typeof input.ageMax === "number") {
    query = query.lte("age_max", input.ageMax);
  }

  if (input.categorySlug) {
    const { data: cat } = await supabase
      .from("categories")
      .select("id")
      .eq("slug", input.categorySlug)
      .maybeSingle();

    if (cat) {
      const { data: pcRows } = await supabase
        .from("product_categories")
        .select("product_id")
        .eq("category_id", (cat as any).id);

      const ids = (pcRows ?? []).map((r: any) => r.product_id as string);
      if (ids.length === 0) {
        return ok({ items: [], total: 0 });
      }
      query = query.in("id", ids);
    } else {
      return ok({ items: [], total: 0 });
    }
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return fail<SearchProductsResult>(error.message, error.code);
  return ok({ items: (data ?? []) as Product[], total: count ?? 0 });
}
