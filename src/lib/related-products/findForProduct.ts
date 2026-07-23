/**
 * Given a product id, classify each active association into two
 * buckets:
 *
 *   sourceMatches → associations whose SOURCE filter matches this
 *                   product (i.e. this product is the kind of viewer
 *                   that fires the carousel)
 *
 *   targetMatches → associations whose TARGET filter would return this
 *                   product as a candidate (i.e. this product gets
 *                   surfaced ON OTHER pages by these carousels)
 *
 * Used by the product editor's "Συνδέσεις προτεινόμενων" tab to show
 * the merchant which carousels reference the product they're editing.
 */

import { viewerMatchesSide } from "./matchSide";
import { resolveTargetCandidates } from "./resolveTarget";
import { buildViewerFromProduct } from "./buildViewer";
import type { ResolverDataset } from "./types";
import type { RelatedProductsAssociationFull } from "@/types/related-products";

export interface AssociationsForProductResult {
  sourceMatches: RelatedProductsAssociationFull[];
  targetMatches: RelatedProductsAssociationFull[];
}

export function findAssociationsForProduct(
  dataset: ResolverDataset,
  product_id: string
): AssociationsForProductResult {
  const viewer = buildViewerFromProduct(dataset, { product_id });
  if (!viewer) {
    return { sourceMatches: [], targetMatches: [] };
  }

  const sourceMatches: RelatedProductsAssociationFull[] = [];
  const targetMatches: RelatedProductsAssociationFull[] = [];

  for (const assoc of dataset.associations) {
    if (!assoc.active) continue;

    if (
      viewerMatchesSide(viewer, assoc.source_groups, dataset.productsById)
    ) {
      sourceMatches.push(assoc);
    }

    // For target matching, resolveTargetCandidates returns ALL products
    // that satisfy the target filter. We just check membership instead
    // of asking "does this single product match?" — same correctness,
    // and the cached candidates set could be reused if we extend.
    const targetCandidates = resolveTargetCandidates(
      assoc.target_groups,
      dataset.productsList
    );
    if (targetCandidates.includes(product_id)) {
      targetMatches.push(assoc);
    }
  }

  return { sourceMatches, targetMatches };
}

