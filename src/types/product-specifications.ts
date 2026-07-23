/**
 * A "specification" is a customer-facing FACT about a product (no choice),
 * distinct from a variant attribute (which is a customer choice).
 */
export interface ProductSpecification {
  id: string;
  product_id: string;
  attribute_id: string;
  value: string;
  display_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * Composed shape returned by `getProductSpecifications` — joins the
 * attribute row in for the admin/storefront display.
 */
export interface ProductSpecificationView {
  id: string;
  attribute_id: string;
  attribute_slug: string;
  attribute_name: string;
  value: string;
  display_order: number;
}
