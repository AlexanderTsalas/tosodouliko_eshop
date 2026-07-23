/**
 * Target-side resolution: given the target filter and the universe of
 * products, return the set of product ids that satisfy the filter.
 *
 *   - Groups OR each other → set union of per-group matches.
 *   - Conditions within a group AND together → product passes the
 *     group only if every condition matches.
 *   - `negate` flips a single condition's sense.
 *
 * Operates on the in-memory ResolverProductData index — no DB I/O.
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
} from "@/types/related-products";
import type { ResolverProductData } from "./types";

export function resolveTargetCandidates(
  groups: RelatedProductsFilterGroupWithConditions[],
  products: ResolverProductData[]
): string[] {
  if (groups.length === 0) return [];
  const matched = new Set<string>();
  for (const g of groups) {
    if (g.conditions.length === 0) continue;
    for (const p of products) {
      if (g.conditions.every((c) => productPassesCondition(c, p))) {
        matched.add(p.id);
      }
    }
  }
  return Array.from(matched);
}

function productPassesCondition(
  condition: RelatedProductsFilterCondition,
  product: ResolverProductData
): boolean {
  const raw = evaluateRaw(condition, product);
  return condition.negate ? !raw : raw;
}

function evaluateRaw(
  condition: RelatedProductsFilterCondition,
  product: ResolverProductData
): boolean {
  switch (condition.kind) {
    case "category": {
      const cfg = condition.config as CategoryConditionConfig;
      return product.category_ids.includes(cfg.category_id);
    }
    case "product": {
      const cfg = condition.config as ProductConditionConfig;
      return product.id === cfg.product_id;
    }
    case "variant": {
      const cfg = condition.config as VariantConditionConfig;
      return product.variants.some((v) => v.id === cfg.variant_id);
    }
    case "attribute_value": {
      const cfg = condition.config as AttributeValueConditionConfig;
      // Variant-axis match wins first; fall back to product-level spec
      // for attributes that aren't part of any variant's combo.
      if (
        product.variants.some(
          (v) => v.attributes[cfg.attribute_id] === cfg.value
        )
      ) {
        return true;
      }
      return product.spec_attributes[cfg.attribute_id] === cfg.value;
    }
    case "attribute_value_in": {
      const cfg = condition.config as AttributeValueInConditionConfig;
      const values = new Set(cfg.values);
      if (
        product.variants.some((v) => {
          const val = v.attributes[cfg.attribute_id];
          return val !== undefined && values.has(val);
        })
      ) {
        return true;
      }
      const specVal = product.spec_attributes[cfg.attribute_id];
      return specVal !== undefined && values.has(specVal);
    }
    case "attribute_present": {
      const cfg = condition.config as AttributePresentConditionConfig;
      if (
        product.variants.some((v) => cfg.attribute_id in v.attributes)
      ) {
        return true;
      }
      return cfg.attribute_id in product.spec_attributes;
    }
    case "tag":
      // Tags not implemented yet.
      return false;
  }
}
