-- =============================================================================
-- Add 'carrier_pickup' to the order_delivery_method enum.
--
-- Distinct from the existing three:
--   * home_delivery            — courier delivers to customer's home
--   * store_pickup             — customer collects from OUR (vendor) shop
--   * delivery_station_pickup  — customer collects from a locker (Box Now, etc.)
--   * carrier_pickup           — NEW: customer collects from the COURIER'S
--                                local office/branch (ACS, ELTA, Speedex
--                                physical depot). The courier needs the
--                                destination branch printed on the voucher
--                                so it routes to the right place.
--
-- ALTER TYPE ADD VALUE can run inside a transaction (PG12+) but the new
-- value can't be referenced in the same transaction. That's fine here —
-- we only add it; app code starts using it after the migration commits.
-- =============================================================================

ALTER TYPE public.order_delivery_method ADD VALUE IF NOT EXISTS 'carrier_pickup';
