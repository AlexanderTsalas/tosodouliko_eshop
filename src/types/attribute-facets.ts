export interface Attribute {
  id: string;
  name: string;
  slug: string;
  type: "select" | "color" | "size" | "text" | string;
  /** When TRUE, attribute_values can carry a price_modifier used as variant-create suggestion. */
  affects_price: boolean;
  /** When TRUE, distinct values of this attribute split a product into separate catalog cards. */
  splits_listing: boolean;
  created_at: string;
}

export interface AttributeValue {
  id: string;
  attribute_id: string;
  value: string;
  /** URL-stable slug, independent of `value` so renames don't break URLs. */
  slug: string;
  /** Absolute price delta suggested at variant creation when parent attribute.affects_price = true. */
  price_modifier: number;
  display_order: number;
  created_at: string;
}
