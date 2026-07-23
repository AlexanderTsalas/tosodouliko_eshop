"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/rbac";
import type { SeoMetadata } from "@/types/dynamic-seo";

/**
 * Product-level SEO metadata for the panel's SEO tab. Independent record
 * from variant SEO (resource_type='product'). Lazy-loaded when the tab
 * is opened.
 */
export async function getProductSeo(
  productId: string
): Promise<SeoMetadata | null> {
  await requirePermission("manage:products");
  const supabase = await createClient();
  const { data } = await supabase
    .from("seo_metadata")
    .select("*")
    .eq("resource_type", "product")
    .eq("resource_id", productId)
    .maybeSingle();
  return (data as SeoMetadata) ?? null;
}
