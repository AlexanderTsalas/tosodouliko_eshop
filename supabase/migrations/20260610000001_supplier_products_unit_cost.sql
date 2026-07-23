-- =============================================================================
-- Cost per (supplier, variant) instead of per product.
--
-- Background: the original schema put cost on products (products.cost_price +
-- products.cost_currency) — a single value for the whole product. In reality
-- the SAME variant can be purchased from multiple suppliers at different
-- prices, AND different variants of the same product can have different
-- supplier costs (size-XL leather costs more than size-S etc).
--
-- This migration:
--   1. Adds unit_cost + unit_cost_currency to supplier_products so cost
--      lives at the granular (supplier, variant) level.
--   2. Backfills supplier_products.unit_cost from products.cost_price for
--      every existing supplier-variant link that doesn't have a cost yet.
--      The product's cost_price is used as the seed; admins can refine
--      per-supplier later.
--
-- The products.cost_price column is RETAINED for now as a fallback used by
-- the Margins report when no supplier is configured for a variant. A later
-- migration may drop it once every variant has supplier coverage.
-- =============================================================================

ALTER TABLE public.supplier_products
  ADD COLUMN IF NOT EXISTS unit_cost numeric(10, 2),
  ADD COLUMN IF NOT EXISTS unit_cost_currency text;

COMMENT ON COLUMN public.supplier_products.unit_cost IS
  'Negotiated unit cost from this supplier for this variant. NULL = unknown / inherited from products.cost_price fallback.';
COMMENT ON COLUMN public.supplier_products.unit_cost_currency IS
  'ISO 4217 currency of unit_cost. Should match supplier.default_currency unless the line is negotiated in a different currency.';

-- Optional consistency: if unit_cost is set, currency must be too.
ALTER TABLE public.supplier_products
  DROP CONSTRAINT IF EXISTS supplier_products_cost_currency_pair;
ALTER TABLE public.supplier_products
  ADD CONSTRAINT supplier_products_cost_currency_pair
  CHECK (
    (unit_cost IS NULL AND unit_cost_currency IS NULL) OR
    (unit_cost IS NOT NULL AND unit_cost_currency IS NOT NULL)
  );

-- Backfill: copy products.cost_price → supplier_products.unit_cost for every
-- existing link that has no cost yet. Currency falls back to the product's
-- cost_currency, then to its sale currency, then EUR.
UPDATE public.supplier_products sp
SET
  unit_cost = p.cost_price,
  unit_cost_currency = COALESCE(p.cost_currency, p.currency, 'EUR')
FROM public.product_variants v
JOIN public.products p ON p.id = v.product_id
WHERE sp.variant_id = v.id
  AND sp.unit_cost IS NULL
  AND p.cost_price IS NOT NULL;
