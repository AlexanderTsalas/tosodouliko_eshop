/**
 * Predicate: does the viewer satisfy a source-side filter?
 *
 * Side semantics:
 *   - Groups OR each other.
 *   - Conditions within a group AND each other.
 *   - `negate` flips a single condition's result.
 *
 * If the side has zero groups → no source filter → the side NEVER
 * matches. (An association without source conditions can't fire.) The
 * resolver also skips the association entirely in that case.
 */

import type {
  RelatedProductsFilterGroupWithConditions,
  RelatedProductsFilterCondition,
  CategoryConditionConfig,
  ProductConditionConfig,
  VariantConditionConfig,
  AttributeValueConditionConfig,
  AttributeValueInConditionConfig,
  AttributePresentConditionConfig,
  TagConditionConfig,
} from "@/types/related-products";
import type { ResolverViewer, ResolverProductData } from "./types";

export function viewerMatchesSide(
  viewer: ResolverViewer,
  groups: RelatedProductsFilterGroupWithConditions[],
  productsById: Map<string, ResolverProductData>
): boolean {
  if (groups.length === 0) return false;
  return groups.some((g) => {
    if (g.conditions.length === 0) return false;
    return g.conditions.every((c) =>
      viewerMatchesCondition(c, viewer, productsById)
    );
  });
}

export function viewerMatchesCondition(
  condition: RelatedProductsFilterCondition,
  viewer: ResolverViewer,
  productsById: Map<string, ResolverProductData>
): boolean {
  const raw = evaluateRaw(condition, viewer, productsById);
  return condition.negate ? !raw : raw;
}

function evaluateRaw(
  condition: RelatedProductsFilterCondition,
  viewer: ResolverViewer,
  productsById: Map<string, ResolverProductData>
): boolean {
  switch (condition.kind) {
    case "category": {
      const cfg = condition.config as CategoryConditionConfig;
      // viewer.category_ids is pre-expanded with ancestors by the
      // loader, so include_descendants is baked in for tree matching.
      return viewer.category_ids.includes(cfg.category_id);
    }
    case "product": {
      const cfg = condition.config as ProductConditionConfig;
      return viewer.product_id === cfg.product_id;
    }
    case "variant": {
      const cfg = condition.config as VariantConditionConfig;
      return viewer.variant_id === cfg.variant_id;
    }
    case "attribute_value": {
      const cfg = condition.config as AttributeValueConditionConfig;
      // Check on the selected variant first; fall back to "any variant
      // of this product has this attribute=value" when no variant is
      // selected. If neither matches, also check product-level specs —
      // the attribute may be attached as a spec rather than as a
      // variant axis on this product.
      if (viewer.variant_id) {
        if (viewer.variant_attributes[cfg.attribute_id] === cfg.value) {
          return true;
        }
      } else {
        const product = productsById.get(viewer.product_id);
        if (
          product?.variants.some(
            (v) => v.attributes[cfg.attribute_id] === cfg.value
          )
        ) {
          return true;
        }
      }
      return viewer.spec_attributes[cfg.attribute_id] === cfg.value;
    }
    case "attribute_value_in": {
      const cfg = condition.config as AttributeValueInConditionConfig;
      const values = new Set(cfg.values);
      if (viewer.variant_id) {
        const v = viewer.variant_attributes[cfg.attribute_id];
        if (v !== undefined && values.has(v)) return true;
      } else {
        const product = productsById.get(viewer.product_id);
        if (
          product?.variants.some((v) => {
            const val = v.attributes[cfg.attribute_id];
            return val !== undefined && values.has(val);
          })
        ) {
          return true;
        }
      }
      const specVal = viewer.spec_attributes[cfg.attribute_id];
      return specVal !== undefined && values.has(specVal);
    }
    case "attribute_present": {
      const cfg = condition.config as AttributePresentConditionConfig;
      if (viewer.variant_id) {
        if (cfg.attribute_id in viewer.variant_attributes) return true;
      } else {
        const product = productsById.get(viewer.product_id);
        if (
          product?.variants.some((v) => cfg.attribute_id in v.attributes)
        ) {
          return true;
        }
      }
      return cfg.attribute_id in viewer.spec_attributes;
    }
    case "tag": {
      // Tags not implemented in the product model yet; reserved.
      void (condition.config as TagConditionConfig);
      return false;
    }
  }
}
