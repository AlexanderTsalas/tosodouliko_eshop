/**
 * Related Products engine — domain types.
 *
 * Mirrors migration 20260611000042. Four tables:
 *
 *   LIBRARY    RelatedProductsAssociation  (top-level carousel def)
 *              RelatedProductsFilterGroup  (per-side group; OR between)
 *              RelatedProductsFilterCondition (per-group condition; AND within)
 *              RelatedProductsManualPick    (curated picks when strategy=manual)
 *
 * Filter algebra: (g1.c1 ∧ g1.c2 ∧ …) ∨ (g2.c1 ∧ g2.c2 ∧ …) per side.
 */

import type { Translations } from "./custom-fields";

// Re-export so consumers don't need to know which module owns it.
export type { Translations };

// ─── Enums ───────────────────────────────────────────────────────────

export type RelatedProductsSide = "source" | "target";

export type RelatedProductsSelectionStrategy =
  | "random"
  | "recent"
  | "manual";

export type RelatedProductsCardGranularity = "product" | "variant";

export type RelatedProductsConditionKind =
  | "category"
  | "product"
  | "variant"
  | "attribute_value"
  | "attribute_value_in"
  | "attribute_present"
  | "tag";

// ─── Condition config shapes (discriminated by `kind`) ───────────────

export interface CategoryConditionConfig {
  category_id: string;
  /** When true, products in any descendant category also match. */
  include_descendants: boolean;
}

export interface ProductConditionConfig {
  product_id: string;
}

export interface VariantConditionConfig {
  variant_id: string;
}

export interface AttributeValueConditionConfig {
  attribute_id: string;
  value: string;
}

export interface AttributeValueInConditionConfig {
  attribute_id: string;
  values: string[];
}

export interface AttributePresentConditionConfig {
  attribute_id: string;
}

export interface TagConditionConfig {
  tag: string;
}

/** Discriminated union — narrow by `condition.kind`. */
export type RelatedProductsConditionConfig =
  | CategoryConditionConfig
  | ProductConditionConfig
  | VariantConditionConfig
  | AttributeValueConditionConfig
  | AttributeValueInConditionConfig
  | AttributePresentConditionConfig
  | TagConditionConfig
  | Record<string, never>;

// ─── Row types (mirror DB columns) ───────────────────────────────────

export interface RelatedProductsAssociation {
  id: string;
  name: string;
  message_title_translations: Translations;
  active: boolean;
  /** Position on a product page where this association renders, where
   *  1 = topmost. Resolver sorts ASC. Replaces the original `priority`
   *  column (which sorted DESC). See migration 20260613000002. */
  display_order: number;
  /** When true, the resolver runs a second pass with source ↔ target
   *  swapped, so a viewer whose product matches the TARGET side sees a
   *  carousel of source-side products. A single page still produces at
   *  most one carousel from this association — source→target wins if
   *  the viewer matches both sides. */
  bidirectional: boolean;
  exclude_oos: boolean;
  selection_strategy: RelatedProductsSelectionStrategy;
  max_results: number;
  card_granularity: RelatedProductsCardGranularity;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface RelatedProductsFilterGroup {
  id: string;
  association_id: string;
  side: RelatedProductsSide;
  sort_order: number;
  created_at: string;
}

export interface RelatedProductsFilterCondition {
  id: string;
  filter_group_id: string;
  kind: RelatedProductsConditionKind;
  config: RelatedProductsConditionConfig;
  negate: boolean;
  sort_order: number;
  created_at: string;
}

export interface RelatedProductsManualPick {
  id: string;
  association_id: string;
  product_id: string;
  sort_order: number;
  added_at: string;
}

// ─── Composite read shapes (for UI) ──────────────────────────────────

/** A group with its conditions loaded, ordered by sort_order. */
export interface RelatedProductsFilterGroupWithConditions
  extends RelatedProductsFilterGroup {
  conditions: RelatedProductsFilterCondition[];
}

/** Association with both sides' groups + conditions loaded. The bench
 *  reads these directly; the resolver reads them at request time. */
export interface RelatedProductsAssociationFull
  extends RelatedProductsAssociation {
  source_groups: RelatedProductsFilterGroupWithConditions[];
  target_groups: RelatedProductsFilterGroupWithConditions[];
  manual_picks: RelatedProductsManualPick[];
}
