-- =============================================================================
-- Phase 7 of courier-integration-design.md — Pickup point columns
--
-- When the customer picks a locker or branch at checkout (delivery_method =
-- delivery_station_pickup or carrier_pickup), the order needs to record:
--
--   pickup_carrier    — slug of the carrier whose location the customer
--                       picked. Matches orders.carrier_slug for the common
--                       case but kept separate so future "carrier_a delivers
--                       to carrier_b's locker" flows work without overloading
--                       carrier_slug.
--   pickup_station_id — the carrier-native identifier (ACS station code,
--                       BoxNow locationId, Geniki locker id). Free text
--                       because each carrier uses its own format.
--   pickup_branch_id  — ACS-style sub-branch index (0 or 1). Null for
--                       carriers that don't subdivide stations (BoxNow,
--                       custom).
--   pickup_type       — "locker" or "branch" so reports / voucher-creation
--                       know which API service flag to set (e.g., ACS REC
--                       for branch reception, locker-specific phone
--                       handling for Smartpoints).
--
-- All nullable: home_delivery and store_pickup orders leave them all null.
-- BoxNow "any-apm" deferred selection also leaves them null and relies on
-- the carrier to assign a locker later.
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pickup_carrier    text,
  ADD COLUMN IF NOT EXISTS pickup_station_id text,
  ADD COLUMN IF NOT EXISTS pickup_branch_id  integer,
  ADD COLUMN IF NOT EXISTS pickup_type       text;

-- Pickup type constraint as a separate statement so re-runs don't fail.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_pickup_type_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_pickup_type_check
  CHECK (pickup_type IS NULL OR pickup_type IN ('locker', 'branch'));

-- Pickup carrier references delivery_carriers when set. ON DELETE SET NULL
-- so deleting a carrier doesn't cascade-block historical orders.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_pickup_carrier_fkey;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_pickup_carrier_fkey
  FOREIGN KEY (pickup_carrier) REFERENCES public.delivery_carriers(slug) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_pickup_carrier_station
  ON public.orders(pickup_carrier, pickup_station_id)
  WHERE pickup_carrier IS NOT NULL;

COMMENT ON COLUMN public.orders.pickup_carrier IS
  'Carrier whose pickup point was selected. Foreign key to delivery_carriers(slug). For built-ins this typically matches orders.carrier_slug; the separate column reserves space for future "carrier A delivers to carrier B''s locker" flows.';
COMMENT ON COLUMN public.orders.pickup_station_id IS
  'Carrier-native identifier of the chosen pickup point (ACS station code, BoxNow locationId, Geniki locker id). Free text because each carrier uses its own format.';
COMMENT ON COLUMN public.orders.pickup_branch_id IS
  'Sub-branch index within an ACS station (0 or 1). Null for carriers that don''t subdivide stations.';
COMMENT ON COLUMN public.orders.pickup_type IS
  '"locker" or "branch". Drives voucher creation flags (e.g., ACS REC for branch reception) and reporting buckets.';
