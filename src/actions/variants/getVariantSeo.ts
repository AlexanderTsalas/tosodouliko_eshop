"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/rbac";
import type { SeoMetadata } from "@/types/dynamic-seo";

/**
 * Per-variant SEO metadata (resource_type='product_variant'), for the
 * panel's ephemeral variant-SEO tab. Independent of product-level SEO.
 */
export async function getVariantSeo(
  variantId: string
): Promise<SeoMetadata | null> {
  await requirePermission("manage:products");
  const supabase = await createClient();
  const { data } = await supabase
    .from("seo_metadata")
    .select("*")
    .eq("resource_type", "product_variant")
    .eq("resource_id", variantId)
    .maybeSingle();
  return (data as SeoMetadata) ?? null;
}
