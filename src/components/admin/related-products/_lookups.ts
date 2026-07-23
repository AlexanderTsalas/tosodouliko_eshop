/**
 * Lookup tables passed from the route page into all the filter-condition
 * UIs (chip popovers, kind pickers). Centralized here so the various
 * editors agree on shape.
 */

export interface FilterLookups {
  categories: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string }>;
  variants: Array<{
    id: string;
    sku: string;
    product_id: string;
    product_name: string;
  }>;
  attributes: Array<{ id: string; name: string; slug: string }>;
  /** Each value belongs to one attribute via attribute_id. Used by the
   *  value popovers to render a finite picker instead of a free-text
   *  input when the admin already defined the attribute's values. */
  attributeValues: Array<{
    id: string;
    attribute_id: string;
    value: string;
  }>;
}
