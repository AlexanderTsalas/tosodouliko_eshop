export interface Product {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  base_price: number;
  currency: string;
  weight_g: number | null;
  /** Outer package dimensions in millimeters — used for volumetric shipping. */
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  /**
   * Optional FK to volumetric_prefixes — the parcel-size tier this
   * product belongs to. Locker/APM couriers use this to map to their
   * size code (BoxNow's 1/2/3, ACS's STD, etc). Raw dimensions above
   * stay authoritative for volumetric-weight calculations.
   */
  volumetric_prefix_id: string | null;
  age_min: number | null;
  age_max: number | null;
  brand: string | null;
  active: boolean;
  /** TRUE = an inline-created draft that hasn't been finalised ("Create
   *  Product") yet. Drafts are born active=false and excluded from the
   *  storefront; finalising clears this flag. */
  is_draft: boolean;
  metadata: Record<string, unknown> | null;
  /** Sparse override of attributes.splits_listing per attribute slug. */
  split_overrides: Record<string, boolean> | null;
  /**
   * Attribute slugs that drive image selection on this product. E.g.
   * `['color']` means the picker color-change swaps images;
   * size-change does not. `[]` = no axes drive imagery (legacy
   * behavior — all images apply to all variants).
   */
  image_axes: string[];
  /** Direct VAT rate override; falls back to category default ⇒ system default when null. */
  vat_rate_id: string | null;
  /** Optional wholesale/manufacturing unit cost. Drives margin metrics only. */
  cost_price: number | null;
  /** ISO 4217 currency of cost_price; may differ from products.currency. */
  cost_currency: string | null;
  /** UX hint only — pre-fills supplier picker for new variants; truth is per-variant in supplier_products. */
  default_supplier_id: string | null;
  /** Admin-chosen SKU prefix; null falls back to slugified product slug. */
  base_sku: string | null;
  /**
   * Per-product override of storefront_settings.show_when_oos_default.
   * NULL = inherit from global. Variant-level override
   * (product_variants.show_when_oos) takes precedence over this.
   */
  show_when_oos: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface ProductImage {
  id: string;
  product_id: string;
  /**
   * Subset of attribute-axis values this image applies to. NULL or
   * empty object = general image (always applies). e.g. `{color: red-uuid}`
   * applies to any variant with color=red regardless of other axes.
   * See docs/product-images-architecture.md for the selection algorithm.
   */
  attribute_combo: Record<string, string> | null;
  /**
   * FK to media_assets — the actual file. NULL only for legacy rows
   * where storage_key was populated directly without going through the
   * media library.
   */
  media_asset_id: string | null;
  url: string | null;
  /**
   * Storage abstraction columns (added in 20260611000020).
   * Preferred over url for new uploads; legacy rows may keep url only.
   */
  storage_key: string | null;
  bucket: string | null;
  alt_text: string | null;
  /**
   * TRUE = alt_text was auto-generated from product.name + combo
   * value labels. Will be regenerated if the underlying labels change.
   * FALSE = admin manually edited.
   */
  alt_text_is_auto: boolean;
  display_order: number;
  /**
   * Marks the cover for this image's (product, attribute_combo) group.
   * Server actions enforce single-cover-per-group via transaction.
   */
  is_cover: boolean;
  created_at: string;
}

export interface ProductWithRelations extends Product {
  images: ProductImage[];
  categories: { category_id: string }[];
  variants?: import("./product-variants").ProductVariant[];
}
