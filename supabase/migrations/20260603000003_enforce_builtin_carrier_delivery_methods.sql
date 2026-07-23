-- =============================================================================
-- Built-in carrier delivery-method ceiling enforcement.
--
-- Mirrors the BUILT_IN_CARRIER_MAX_DELIVERY_METHODS constant in
-- src/config/built-in-carrier-capabilities.ts. The two MUST stay in sync —
-- when a built-in carrier physically gains a new method (e.g. BoxNow
-- launches home delivery), both this trigger and the TS constant get
-- updated together.
--
-- Defence in depth model:
--   Layer 1 — UI: DeliveryCarrierForm hides out-of-ceiling checkboxes
--   Layer 2 — Server action: updateCarrier rejects out-of-ceiling values
--   Layer 3 — DB: this trigger fail-closes on any INSERT/UPDATE path,
--             including direct SQL, future admin tools, and bug-induced
--             bypasses of the action layer.
--
-- Custom carriers (is_custom=true) are EXEMPT — admins know what their
-- custom carrier physically does.
--
-- The trigger raises 'check_violation' (rather than a custom error code)
-- so existing PostgREST error handlers route it like a CHECK constraint.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_builtin_carrier_delivery_methods()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_max          text[];
  v_out_of_bound text[];
BEGIN
  -- Custom carriers: admin defines their own capabilities.
  IF NEW.is_custom THEN
    RETURN NEW;
  END IF;

  v_max := CASE NEW.slug
    WHEN 'acs'     THEN ARRAY['home_delivery','delivery_station_pickup','carrier_pickup']
    WHEN 'elta'    THEN ARRAY['home_delivery','delivery_station_pickup','carrier_pickup']
    -- BoxNow is locker-only. No home delivery, no branches.
    WHEN 'box_now' THEN ARRAY['delivery_station_pickup']
    -- Speedex has a courier + branch network but no APMs.
    WHEN 'speedex' THEN ARRAY['home_delivery','carrier_pickup']
    WHEN 'geniki'  THEN ARRAY['home_delivery','delivery_station_pickup','carrier_pickup']
    -- Unknown slug (e.g. a future built-in seeded before this trigger is
    -- updated): allow through so trigger doesn't block forward-compatible
    -- seeds. The TS constant + form layer catch this earlier.
    ELSE NULL
  END;

  IF v_max IS NULL THEN
    RETURN NEW;
  END IF;

  -- Diff: methods on NEW.supported_delivery_methods that aren't in v_max.
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

COMMENT ON FUNCTION public.enforce_builtin_carrier_delivery_methods()
IS 'Enforces the physical-capability ceiling for built-in carrier rows in delivery_carriers. Mirrors src/config/built-in-carrier-capabilities.ts. Custom carriers exempt.';

DROP TRIGGER IF EXISTS trg_enforce_builtin_carrier_delivery_methods
  ON public.delivery_carriers;

CREATE TRIGGER trg_enforce_builtin_carrier_delivery_methods
  BEFORE INSERT OR UPDATE OF supported_delivery_methods, is_custom, slug
  ON public.delivery_carriers
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_builtin_carrier_delivery_methods();
