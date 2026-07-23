-- =============================================================================
-- Phase 8a — Inventory primitives migrated to custom SQLSTATE codes.
--
-- Background:
--   Today the primitives raise via:
--     RAISE EXCEPTION 'INSUFFICIENT_SOFT_HELD';
--   producing SQLSTATE 'P0001' (generic raise_exception). Callers have
--   no way to distinguish benign races (race-with-reaper) from real
--   failures (deadlock, lock wait) except by string-matching SQLERRM.
--
--   This migration redefines every primitive to raise with the custom
--   SQLSTATE codes reserved in migration 20260611000004:
--     ISFTL  — INSUFFICIENT_SOFT_HELD
--     IRSRV  — INSUFFICIENT_RESERVED
--     IINVT  — INSUFFICIENT_INVENTORY
--     IPRIO  — INSUFFICIENT_PRIORITY_HELD
--     INVQT  — INVALID_QUANTITY
--
--   Each function also gains:
--     - SECURITY DEFINER + SET search_path = public, pg_temp
--     - REVOKE EXECUTE FROM PUBLIC, anon, authenticated
--     - GRANT EXECUTE TO service_role
--   to follow the safety convention established in Phase 0.
--
--   Backward compatibility:
--     - The MESSAGE field still contains the legacy string text
--       (e.g. 'INSUFFICIENT_SOFT_HELD') so unmigrated callers that
--       string-match on SQLERRM still work during the transition.
--     - The SQLSTATE is now the typed code; new callers should check
--       error.code rather than error.message.
--
--   Phase 8b migrates the reapers to catch by SQLSTATE.
-- =============================================================================

-- ──── hold_soft ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hold_soft(p_variant_id uuid, p_qty integer)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result public.inventory_items;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'INVQT', MESSAGE = 'INVALID_QUANTITY';
  END IF;

  -- Opportunistic: release any expired sessions touching this variant
  -- before we evaluate availability. Eliminates the contested-click gap
  -- between session expiry and the next cron tick.
  BEGIN
    PERFORM public.cleanup_expired_sessions_for_variant(p_variant_id);
  EXCEPTION WHEN OTHERS THEN
    -- Cleanup failure must not abort the hold attempt — the reaper
    -- cron will catch up. Log via system_errors so non-benign cleanup
    -- failures stop being invisible.
    PERFORM public.log_system_error(
      'hold_soft.opportunistic_cleanup',
      'warn',
      SQLSTATE,
      SQLERRM,
      'variant',
      p_variant_id
    );
  END;

  UPDATE public.inventory_items
  SET quantity_available = quantity_available - p_qty,
      quantity_soft_held = quantity_soft_held + p_qty,
      updated_at         = now()
  WHERE variant_id = p_variant_id
    AND quantity_available >= p_qty
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'IINVT', MESSAGE = 'INSUFFICIENT_INVENTORY';
  END IF;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hold_soft(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.hold_soft(uuid, integer) TO service_role;

-- ──── release_soft ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.release_soft(p_variant_id uuid, p_qty integer)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result public.inventory_items;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'INVQT', MESSAGE = 'INVALID_QUANTITY';
  END IF;

  UPDATE public.inventory_items
  SET quantity_available = quantity_available + p_qty,
      quantity_soft_held = quantity_soft_held - p_qty,
      updated_at         = now()
  WHERE variant_id = p_variant_id
    AND quantity_soft_held >= p_qty
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ISFTL', MESSAGE = 'INSUFFICIENT_SOFT_HELD';
  END IF;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.release_soft(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.release_soft(uuid, integer) TO service_role;

-- ──── reserve_inventory ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reserve_inventory(p_variant_id uuid, p_qty integer)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result public.inventory_items;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'INVQT', MESSAGE = 'INVALID_QUANTITY';
  END IF;

  UPDATE public.inventory_items
  SET quantity_available = quantity_available - p_qty,
      quantity_reserved  = quantity_reserved  + p_qty,
      updated_at         = now()
  WHERE variant_id = p_variant_id
    AND quantity_available >= p_qty
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'IINVT', MESSAGE = 'INSUFFICIENT_INVENTORY';
  END IF;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_inventory(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reserve_inventory(uuid, integer) TO service_role;

-- ──── release_reservation ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.release_reservation(p_variant_id uuid, p_qty integer)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result public.inventory_items;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'INVQT', MESSAGE = 'INVALID_QUANTITY';
  END IF;

  UPDATE public.inventory_items
  SET quantity_available = quantity_available + p_qty,
      quantity_reserved  = quantity_reserved  - p_qty,
      updated_at         = now()
  WHERE variant_id = p_variant_id
    AND quantity_reserved >= p_qty
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'IRSRV', MESSAGE = 'INSUFFICIENT_RESERVED';
  END IF;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.release_reservation(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.release_reservation(uuid, integer) TO service_role;

-- ──── promote_soft_to_reserved ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.promote_soft_to_reserved(p_variant_id uuid, p_qty integer)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result public.inventory_items;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'INVQT', MESSAGE = 'INVALID_QUANTITY';
  END IF;

  UPDATE public.inventory_items
  SET quantity_soft_held = quantity_soft_held - p_qty,
      quantity_reserved  = quantity_reserved  + p_qty,
      updated_at         = now()
  WHERE variant_id = p_variant_id
    AND quantity_soft_held >= p_qty
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ISFTL', MESSAGE = 'INSUFFICIENT_SOFT_HELD';
  END IF;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.promote_soft_to_reserved(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.promote_soft_to_reserved(uuid, integer) TO service_role;

-- ──── consume_reservation ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.consume_reservation(p_variant_id uuid, p_qty integer)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result public.inventory_items;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'INVQT', MESSAGE = 'INVALID_QUANTITY';
  END IF;

  UPDATE public.inventory_items
  SET quantity_reserved = quantity_reserved - p_qty,
      updated_at        = now()
  WHERE variant_id = p_variant_id
    AND quantity_reserved >= p_qty
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'IRSRV', MESSAGE = 'INSUFFICIENT_RESERVED';
  END IF;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_reservation(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.consume_reservation(uuid, integer) TO service_role;

-- ──── restore_inventory ─────────────────────────────────────────────────────
-- INVENTORY_NOT_FOUND keeps the generic P0001 since no batch SQLSTATE
-- was reserved for it (it's an existence error, not a quantity race).
CREATE OR REPLACE FUNCTION public.restore_inventory(p_variant_id uuid, p_qty integer)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result public.inventory_items;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'INVQT', MESSAGE = 'INVALID_QUANTITY';
  END IF;

  UPDATE public.inventory_items
  SET quantity_available = quantity_available + p_qty,
      updated_at         = now()
  WHERE variant_id = p_variant_id
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'INVENTORY_NOT_FOUND';
  END IF;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.restore_inventory(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.restore_inventory(uuid, integer) TO service_role;

-- ──── decrement_inventory ───────────────────────────────────────────────────
-- Legacy direct-decrement path. Kept as fallback for pre-Phase-1 orders.
CREATE OR REPLACE FUNCTION public.decrement_inventory(p_variant_id uuid, p_qty integer)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result public.inventory_items;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'INVQT', MESSAGE = 'INVALID_QUANTITY';
  END IF;

  UPDATE public.inventory_items
  SET quantity_available = quantity_available - p_qty,
      updated_at = now()
  WHERE variant_id = p_variant_id
    AND quantity_available >= p_qty
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'IINVT', MESSAGE = 'INSUFFICIENT_INVENTORY';
  END IF;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decrement_inventory(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.decrement_inventory(uuid, integer) TO service_role;

-- ──── promote_to_priority ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.promote_to_priority(
  p_variant_id uuid,
  p_qty        integer
)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result public.inventory_items;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'INVQT', MESSAGE = 'INVALID_QUANTITY';
  END IF;

  UPDATE public.inventory_items
  SET quantity_available     = quantity_available     - p_qty,
      quantity_priority_held = quantity_priority_held + p_qty,
      updated_at             = now()
  WHERE variant_id = p_variant_id
    AND quantity_available >= p_qty
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'IINVT', MESSAGE = 'INSUFFICIENT_INVENTORY';
  END IF;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.promote_to_priority(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.promote_to_priority(uuid, integer) TO service_role;

-- ──── release_priority ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.release_priority(
  p_variant_id uuid,
  p_qty        integer
)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result public.inventory_items;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'INVQT', MESSAGE = 'INVALID_QUANTITY';
  END IF;

  UPDATE public.inventory_items
  SET quantity_priority_held = quantity_priority_held - p_qty,
      quantity_available     = quantity_available     + p_qty,
      updated_at             = now()
  WHERE variant_id = p_variant_id
    AND quantity_priority_held >= p_qty
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'IPRIO', MESSAGE = 'INSUFFICIENT_PRIORITY_HELD';
  END IF;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.release_priority(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.release_priority(uuid, integer) TO service_role;

-- ──── consume_priority_to_soft ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.consume_priority_to_soft(
  p_variant_id uuid,
  p_qty        integer
)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result public.inventory_items;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'INVQT', MESSAGE = 'INVALID_QUANTITY';
  END IF;

  UPDATE public.inventory_items
  SET quantity_priority_held = quantity_priority_held - p_qty,
      quantity_soft_held     = quantity_soft_held     + p_qty,
      updated_at             = now()
  WHERE variant_id = p_variant_id
    AND quantity_priority_held >= p_qty
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'IPRIO', MESSAGE = 'INSUFFICIENT_PRIORITY_HELD';
  END IF;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_priority_to_soft(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.consume_priority_to_soft(uuid, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
