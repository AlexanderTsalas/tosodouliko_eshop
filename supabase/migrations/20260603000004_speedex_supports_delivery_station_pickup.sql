-- =============================================================================
-- Speedex Service Points — broaden Speedex's physical-capability ceiling
-- to include delivery_station_pickup.
--
-- Speedex operates a Service Point / locker network alongside its standard
-- courier + branch services. The original Phase 0 seed and the trigger
-- added in 20260603000003 modeled Speedex as home + branch only, which
-- blocked admins from offering Speedex APMs at checkout.
--
-- This migration:
--   1. Replaces the trigger function so the ceiling for 'speedex' includes
--      'delivery_station_pickup'. CREATE OR REPLACE keeps the change
--      idempotent — re-running has no effect.
--   2. Adds 'delivery_station_pickup' to the existing speedex row's
--      supported_delivery_methods (idempotent via NOT IN check).
--
-- Source-of-truth: src/config/built-in-carrier-capabilities.ts. Keep both
-- in sync when adjusting any built-in's physical capabilities.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_builtin_carrier_delivery_methods()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_max          text[];
  v_out_of_bound text[];
BEGIN
  IF NEW.is_custom THEN
    RETURN NEW;
  END IF;

  v_max := CASE NEW.slug
    WHEN 'acs'     THEN ARRAY['home_delivery','delivery_station_pickup','carrier_pickup']
    WHEN 'elta'    THEN ARRAY['home_delivery','delivery_station_pickup','carrier_pickup']
    -- BoxNow is locker-only. No home delivery, no branches.
    WHEN 'box_now' THEN ARRAY['delivery_station_pickup']
    -- Speedex: home + Service Point (APM) + branch.
    WHEN 'speedex' THEN ARRAY['home_delivery','delivery_station_pickup','carrier_pickup']
    WHEN 'geniki'  THEN ARRAY['home_delivery','delivery_station_pickup','carrier_pickup']
    ELSE NULL
  END;

  IF v_max IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(m) INTO v_out_of_bound
    FROM unnest(NEW.supported_delivery_methods) m
   WHERE m <> ALL(v_max);

  IF v_out_of_bound IS NOT NULL AND array_length(v_out_of_bound, 1) > 0 THEN
    RAISE EXCEPTION
      'Built-in carrier % cannot support delivery method(s) outside its physical ceiling. Attempted: %, ceiling: %',
      NEW.slug, v_out_of_bound, v_max
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Extend the existing Speedex row's enabled methods to include APMs. Done
-- idempotently with array_append guarded by NOT IN so re-runs are no-ops.
UPDATE public.delivery_carriers
   SET supported_delivery_methods =
         array_append(supported_delivery_methods, 'delivery_station_pickup'),
       updated_at = now()
 WHERE slug = 'speedex'
   AND NOT ('delivery_station_pickup' = ANY(supported_delivery_methods));
