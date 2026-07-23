-- =============================================================================
-- Document orders.tax_amount semantics.
--
-- Background:
--   The orders.tax_amount column was always 0 in practice because the
--   placeOrder + createOrder actions both default it to 0 with comments
--   like "Tax still a placeholder — handled separately by upcoming phases."
--
--   The audit flagged this as L2 (low — either populate or drop). After
--   review, the correct answer is NEITHER:
--
--   - Don't drop: prices in this store are VAT-INCLUSIVE (Greek
--     convention), so customers don't pay "extra tax on top". The
--     column exists for display transparency: "subtotal includes X€
--     of VAT" — but that derived value isn't load-bearing for any
--     calculation. The total + subtotal already encode the right
--     amount the customer pays.
--
--   - Don't populate eagerly: doing so requires per-line VAT resolution
--     (product → category → vat_rates chain) which adds a query path
--     to the hot checkout flow. The right place is when the customer
--     storefront grows a "VAT breakdown" line — at that point we
--     populate at order time using the same resolveEffectiveVatRate()
--     the admin reports use, and surface it in the order receipt.
--
-- This migration just documents the column so future readers (humans
-- and AI alike) don't waste cycles wondering why it's always 0.
-- =============================================================================

COMMENT ON COLUMN public.orders.tax_amount IS
'VAT PORTION of the order (informational, not additive). Prices are VAT-inclusive (Greek convention), so this number is included in `subtotal` and NEVER added to `total`. Currently always 0 because the storefront has no VAT-breakdown line yet; populated by per-line resolveEffectiveVatRate() snapshot when that surface ships. Safe to ignore for total computation; safe to display when populated.';

NOTIFY pgrst, 'reload schema';
