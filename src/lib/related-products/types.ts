/**
 * Resolver-internal types for the related-products engine.
 *
 * The resolver is a pure TS function that takes a "viewer" (the product
 * page the customer is on) plus the full association library plus an
 * index of all products/variants, and returns up to 3 ranked carousels.
 *
 * Data is loaded once per request by `loadResolverData` and passed in;
 * the resolver itself does no DB I/O so it's trivially testable.
 */

import type { Translations } from "@/types/related-products";

/** The product page the customer is on. The resolver matches each
 *  active association's source filter against this. */
export interface ResolverViewer {
  product_id: string;
  /** When the customer has selected a variant, the engine can match
   *  variant-level conditions. When null, variant-level conditions
   *  fail; product-level + attribute-level conditions still work via
   *  the product's full variant set. */
  variant_id: string | null;
  /** All categories the product belongs to, EXPANDED with ancestors.
   *  Pre-computed by the loader so the resolver doesn't traverse the
   *  category tree at runtime. */
  category_ids: string[];
  /** When variant_id is set, this is that variant's attribute_combo.
   *  Used for attribute_value / attribute_value_in / attribute_present
   *  conditions at the variant level. */
  variant_attributes: Record<string, string>;
  /** Product-level specifications, denormalised from product_specifications
   *  with `value` text resolved to `attribute_values.id`. Same for every
   *  variant of the product. Used to make attribute_value / _in / _present
   *  conditions match attributes that live as specs rather than as
   *  variant axes. Spec rows whose value text doesn't match any defined
   *  attribute_value (free-form specs) drop out of this map — they can't
   *  match UUID-keyed conditions anyway. */
  spec_attributes: Record<string, string>;
}

/** Per-product data needed by target-side resolution + OOS checks. */
export interface ResolverProductData {
  id: string;
  name: string;
  created_at: string;
  /** Direct + ancestor categories (already expanded). */
  category_ids: string[];
  /** All variants of this product with their attribute_combo + stock. */
  variants: Array<{
    id: string;
    attributes: Record<string, string>;
    quantity_available: number;
  }>;
  /** Same shape and semantics as ResolverViewer.spec_attributes — but
   *  here for use during TARGET-side filtering. See that field's doc. */
  spec_attributes: Record<string, string>;
}

/** Output of one resolved carousel. */
export interface ResolvedCarousel {
  association_id: string;
  /** Empty translations object → frontend renders the fallback
   *  "Προτεινόμενα Προϊόντα". */
  title_translations: Translations;
  card_granularity: "product" | "variant";
  /** Position the carousel should render at, 1 = topmost. Lower wins
   *  when multiple carousels are emitted. */
  display_order: number;
  selection_strategy: "random" | "recent" | "manual";
  /** Top-N products selected from the candidate set by the strategy. */
  products: Array<{
    id: string;
    name: string;
  }>;
  /** Debug hint — first source group/condition that triggered the
   *  match. Useful in the admin debug panel; storefront ignores. */
  matched_by?: string;
  /** Which direction of a bidirectional association produced this
   *  carousel. `forward` is the default (source matched, target shown);
   *  `reverse` only appears on bidirectional associations whose source
   *  side did NOT match the viewer but target side did, with the engine
   *  having swapped source ↔ target internally. */
  direction?: "forward" | "reverse";
}

/** Warnings returned alongside the carousels. These describe
 *  configuration anomalies the admin should know about — e.g. an
 *  association marked bidirectional whose source and target sides both
 *  matched the same viewer. We never raise these on the storefront UI;
 *  they're consumed by the admin "Test Προτεινόμενων" drawer. */
export type ResolverWarning =
  | {
      kind: "bidirectional_overlap";
      association_id: string;
      association_name: string;
      /** Always "forward" — overlap detection only fires when source
       *  matched (we ignore the reverse direction by policy when both
       *  sides match). */
      kept_direction: "forward";
    };

/** Combined result of a resolver run. */
export interface ResolverResult {
  carousels: ResolvedCarousel[];
  warnings: ResolverWarning[];
}

export interface ResolverDataset {
  associations: Array<
    import("@/types/related-products").RelatedProductsAssociationFull
  >;
  /** Indexed for O(1) lookup; arrays accessible via productsList. */
  productsById: Map<string, ResolverProductData>;
  productsList: ResolverProductData[];
}
