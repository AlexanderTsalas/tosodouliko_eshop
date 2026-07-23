/**
 * Pure helper: build a ResolverViewer from a product id (+ optional
 * variant id) using an already-loaded ResolverDataset.
 *
 * Lives in its own file (no `"use server"`) so it can be imported into
 * client-rendered debug tools without the server-actions runtime
 * tripping on the sync export.
 */

import type { ResolverDataset, ResolverViewer } from "./types";

export function buildViewerFromProduct(
  dataset: ResolverDataset,
  args: { product_id: string; variant_id?: string | null }
): ResolverViewer | null {
  const product = dataset.productsById.get(args.product_id);
  if (!product) return null;
  let variant_attributes: Record<string, string> = {};
  let variant_id: string | null = args.variant_id ?? null;
  if (variant_id) {
    const v = product.variants.find((x) => x.id === variant_id);
    if (v) variant_attributes = v.attributes;
    else variant_id = null;
  }
  return {
    product_id: product.id,
    variant_id,
    category_ids: product.category_ids,
    variant_attributes,
    // Specs are product-level, so they're the same regardless of which
    // (if any) variant the customer has selected.
    spec_attributes: product.spec_attributes,
  };
}
