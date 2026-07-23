-- =============================================================================
-- Phase 3 of courier-integration-design.md — Tracking model
--
-- Adds two columns to orders so customers can track their shipment regardless
-- of whether the carrier is API-integrated or operated manually by the
-- merchant:
--
--   tracking_number       — set automatically by createVoucher (API path) or
--                           typed by the merchant on the admin order page
--                           (manual path). Combined with the carrier's
--                           tracking_url_template at render time to produce
--                           the "Track on {carrier}" button URL.
--
--   tracking_url_override — one-off URL when the carrier's standard template
--                           doesn't apply (e.g., a merchant has their own
--                           internal tracking portal for a custom carrier).
--                           Wins over template+number when set.
--
-- delivery_carriers.tracking_url_template was already added in Phase 0
-- (20260601000020) — Phase 3's remaining work is the per-order columns.
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tracking_number       text,
  ADD COLUMN IF NOT EXISTS tracking_url_override text;

CREATE INDEX IF NOT EXISTS idx_orders_tracking_number
  ON public.orders(tracking_number)
  WHERE tracking_number IS NOT NULL;

COMMENT ON COLUMN public.orders.tracking_number IS
  'Carrier voucher / parcel ID. Set by createVoucher for API-integrated carriers; manually entered via the admin order page for non-integrated and custom carriers. Combined with delivery_carriers.tracking_url_template to build the customer-facing "Track on {carrier}" button URL.';
COMMENT ON COLUMN public.orders.tracking_url_override IS
  'One-off tracking URL when the carrier''s template doesn''t apply (custom internal portals, unusual third-party trackers). Wins over template+tracking_number when set.';
