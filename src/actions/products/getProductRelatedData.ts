"use server";

import { requirePermission } from "@/lib/rbac";
import {
  loadResolverData,
  findAssociationsForProduct,
} from "@/lib/related-products";
import type { RelatedProductsAssociationFull } from "@/types/related-products";

/**
 * Read-only related-products summary for the panel's "Σχετικά" tab:
 * which active associations this product is the SOURCE of, and which ones
 * TARGET it. Full editing still lives in the /admin/related-products
 * workshop. Lazy-loaded when the tab is opened.
 */
export async function getProductRelatedData(productId: string): Promise<{
  sourceMatches: RelatedProductsAssociationFull[];
  targetMatches: RelatedProductsAssociationFull[];
}> {
  await requirePermission("manage:products");
  const dataset = await loadResolverData();
  const { sourceMatches, targetMatches } = findAssociationsForProduct(
    dataset,
    productId
  );
  return { sourceMatches, targetMatches };
}
