-- =============================================================================
-- Per-variant weight, required for carrier API quotes.
--
-- ACS_Price_Calculation rejects parcels under 0.5 kg, so we use that as the
-- default for backfill — variant rows with no real weight set yet still
-- produce a valid (just minimum-priced) quote rather than breaking the call.
--
-- The admin should walk through the catalog and set actual weights when
-- they're ready to switch shipping to API-driven mode. Custom-rate mode
-- doesn't read this column, so a default-0.5 placeholder is fine
-- indefinitely while the merchant is still in custom mode.
-- =============================================================================

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS weight_kg numeric(8,3) NOT NULL DEFAULT 0.500;

COMMENT ON COLUMN public.product_variants.weight_kg IS
  'Per-variant weight in kilograms. ACS minimum is 0.5 kg; carrier APIs clamp to that. Required for API-mode shipping quotes; ignored in custom-rate mode.';
