-- =============================================================================
-- Phase 1b — Custom SQLSTATE codes used by inventory + order primitives.
--
-- Background:
--   The current inventory primitives raise via
--     RAISE EXCEPTION 'INSUFFICIENT_SOFT_HELD'
--   which produces SQLSTATE 'P0001' (the default `raise_exception`) and
--   the message becomes the only signal callers can match on. Reapers
--   then use string-matching:
--     EXCEPTION WHEN OTHERS THEN
--       IF SQLERRM NOT LIKE '%INSUFFICIENT_SOFT_HELD%' THEN ... END IF;
--
--   This pattern conflates benign races (`INSUFFICIENT_*` from a lost
--   race with another path) with REAL failures (deadlock, FK violation,
--   serialization conflict). Both currently look the same in the logs.
--
-- This migration:
--   1. Reserves a small set of custom 5-character SQLSTATE codes
--      for the codebase's known inventory/order conditions
--   2. Documents them via COMMENT ON FUNCTION on a no-op function so
--      `\df+ public._documentation_*` in psql surfaces the reference
--
-- The codes themselves don't have any effect until Phase 8 updates
-- each primitive to RAISE EXCEPTION USING ERRCODE = '<code>'. After
-- that, reaper catches become:
--     EXCEPTION WHEN SQLSTATE 'ISFTL' THEN CONTINUE;
--
-- That's the only way to make Postgres tell us "this is a real
-- failure, log it" vs "this is the expected benign race, swallow it."
--
-- SQLSTATE format rules:
--   - 5 ASCII characters
--   - First character class:
--       '0'–'4'  reserved (PG built-in)
--       'P'       reserved (PG plpgsql) for codes starting "P0xxxx"
--   - Everything else is fair game for user-defined codes
--
-- Codes chosen ('I' prefix for inventory + valid first char):
--   ISFTL — INSUFFICIENT_SOFT_HELD     (release_soft, promote_soft_to_reserved)
--   IRSRV — INSUFFICIENT_RESERVED      (release_reservation, consume_reservation)
--   IINVT — INSUFFICIENT_INVENTORY     (hold_soft, reserve_inventory, decrement_inventory)
--   IPRIO — INSUFFICIENT_PRIORITY_HELD (release_priority, consume_priority_to_soft)
--   INVQT — INVALID_QUANTITY           (qty <= 0 on any inventory primitive)
-- =============================================================================

CREATE OR REPLACE FUNCTION public._documentation_custom_sqlstates()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- This function is intentionally empty. It exists only to host the
  -- COMMENT ON FUNCTION below as a discoverable reference.
  RAISE NOTICE 'See COMMENT ON FUNCTION public._documentation_custom_sqlstates() for the canonical SQLSTATE map.';
END;
$$;

COMMENT ON FUNCTION public._documentation_custom_sqlstates() IS
'Canonical map of custom SQLSTATE codes used by inventory + order primitives in this codebase.

Raise:
    RAISE EXCEPTION USING ERRCODE = ''ISFTL'', MESSAGE = ''INSUFFICIENT_SOFT_HELD'';

Catch:
    EXCEPTION WHEN SQLSTATE ''ISFTL'' THEN ... CONTINUE; (benign)
    EXCEPTION WHEN OTHERS         THEN ... PERFORM log_system_error(...); (real)

Codes:
  ISFTL — INSUFFICIENT_SOFT_HELD     (release_soft, promote_soft_to_reserved)
  IRSRV — INSUFFICIENT_RESERVED      (release_reservation, consume_reservation)
  IINVT — INSUFFICIENT_INVENTORY     (hold_soft, reserve_inventory, decrement_inventory)
  IPRIO — INSUFFICIENT_PRIORITY_HELD (release_priority, consume_priority_to_soft)
  INVQT — INVALID_QUANTITY           (qty <= 0 on any inventory primitive)

Phase 8 of the data-layer remediation rewrites every primitive to raise
with these codes, then narrows reaper catches accordingly. Until Phase 8
ships, primitives still raise the plain SQLSTATE P0001 and reapers
still string-match on SQLERRM — this migration only reserves the
codespace.';

-- This documentation function is harmless even if executable, but lock
-- it down anyway to follow the codebase convention.
REVOKE EXECUTE ON FUNCTION public._documentation_custom_sqlstates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._documentation_custom_sqlstates() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
