-- =============================================================================
-- Add fee breakdown columns to orders.
--
-- `fees_total` is the sum of all user-defined fees (shipping + COD handling +
-- whatever else). `fees_breakdown` is the per-category detail:
--
--   [
--     {
--       "category_slug": "shipping",
--       "label": "Μεταφορικά",
--       "display_order": 10,
--       "charged": 5.00,
--       "api_quote": 4.32,            -- always written when an API quote was obtainable
--       "source": "custom_rule",      -- or "api"
--       "rule_id": "..."              -- when source='custom_rule'
--     },
--     ...
--   ]
--
-- Existing `shipping_amount` column stays for one cycle so we don't break any
-- existing read paths. The fee resolver writes both — fees_breakdown[shipping]
-- and the legacy shipping_amount column with the same number. We'll drop
-- shipping_amount in a later migration after every read site has moved over.
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fees_total     numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fees_breakdown jsonb         NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_orders_fees_breakdown_gin
  ON public.orders USING GIN (fees_breakdown);

COMMENT ON COLUMN public.orders.fees_total IS
  'Sum of all fees in fees_breakdown. Frozen on order placement; not recomputed if fee rules change later.';
COMMENT ON COLUMN public.orders.fees_breakdown IS
  'Per-category breakdown of fees charged on this order, in display_order. Each entry has category_slug, label, charged, source, optional api_quote.';
