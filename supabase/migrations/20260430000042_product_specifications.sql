-- =============================================================================
-- Product specifications (Phase J1).
--
-- A "specification" is a customer-facing FACT about a product (no choice),
-- distinct from a "variant attribute" which is a customer-facing CHOICE.
--
--   variant attribute: "Colour: Red / Blue / Green"  (selectable)
--   specification:     "Battery slot: 18650"         (informational, queryable)
--
-- Specs share the same `attributes` registry as variant attributes so that:
--   - the filter sidebar's "Battery type" facet aggregates BOTH variant
--     attribute values AND spec values into one unified count.
--   - auto-categories can match against specs the same way they match
--     against variant attributes.
--   - the admin vocabulary stays consistent (no risk of "18650" vs
--     "18650mAh" creating phantom buckets).
--
-- An attribute can be a variant on one product and a spec on another, but
-- not both on the same product — that constraint is enforced at the action
-- layer (we'd need a runtime check of attribute_combo to do it in SQL).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.product_specifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  attribute_id    uuid NOT NULL REFERENCES public.attributes(id) ON DELETE CASCADE,
  -- The spec value. Usually mirrors an attribute_values.value but kept as
  -- plain text to support free-form values when the attribute has no
  -- pre-defined vocabulary.
  value           text NOT NULL,
  display_order   int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- One value per (product, attribute) — admins set "battery: 18650" once
  -- per product, not multiple times.
  UNIQUE(product_id, attribute_id)
);

-- Hot read paths:
--   - "all specs for this product" (admin overview + storefront panel)
--   - "all products matching attribute X = value Y" (filter + auto-category)
CREATE INDEX IF NOT EXISTS idx_product_specs_product
  ON public.product_specifications(product_id);
CREATE INDEX IF NOT EXISTS idx_product_specs_attr_value
  ON public.product_specifications(attribute_id, value);

COMMENT ON TABLE public.product_specifications IS
  'Product-level customer-facing facts (battery type, dimensions, etc.). Filterable and categorisable; not selectable by customer. Distinct from variant attributes.';
