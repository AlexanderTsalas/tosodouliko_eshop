export interface ProductVariant {
  id: string;
  product_id: string;
  sku: string;
  price: number;
  attribute_combo: Record<string, string> | null;
  is_active: boolean;
  /** When false, never appears in Supply Orders auto-suggestions. */
  track_supply: boolean;
  /**
   * Per-variant override of show_when_oos. NULL = inherit from
   * products.show_when_oos, then storefront_settings.show_when_oos_default.
   */
  show_when_oos: boolean | null;
  created_at: string;
}
