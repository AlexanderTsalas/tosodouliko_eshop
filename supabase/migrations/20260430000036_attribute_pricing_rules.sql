-- =============================================================================
-- Attribute pricing rules.
--
-- - `attributes.affects_price`: when TRUE, the attribute's values can carry a
--   price modifier (e.g., Size: L = +€2). When FALSE, the attribute is purely
--   descriptive (e.g., Flavour, Colour).
-- - `attribute_values.price_modifier`: absolute amount added to the base price
--   when this value is part of a variant's attribute_combo.
--
-- Modifiers are *suggestions* applied at variant creation time. The final
-- price is stored in product_variants.price (existing column) and remains
-- the source of truth — changing a modifier later does NOT retroactively
-- reprice existing variants.
-- =============================================================================

ALTER TABLE public.attributes
  ADD COLUMN IF NOT EXISTS affects_price boolean NOT NULL DEFAULT false;

ALTER TABLE public.attribute_values
  ADD COLUMN IF NOT EXISTS price_modifier numeric(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.attributes.affects_price IS
  'When TRUE, attribute_values for this attribute can carry a price_modifier that is suggested as the default delta on variant creation.';

COMMENT ON COLUMN public.attribute_values.price_modifier IS
  'Absolute price delta (in the product currency) applied when this value is part of a variant''s attribute_combo. Used only when the parent attribute.affects_price is TRUE. Computed at variant creation only — never read at storefront runtime.';
