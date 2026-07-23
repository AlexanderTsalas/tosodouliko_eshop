-- =============================================================================
-- Heartbeat-based liveness fallback for soft sessions.
--
-- Companion to the pagehide-beacon release path (release_soft_session). The
-- beacon is the *primary* release signal in modern browsers (Navigation API
-- lets the client distinguish refresh from close, so the beacon only fires
-- on genuine close/navigate-away). This heartbeat scheme is the *fallback*:
--
--   1. Older browsers (no Navigation API) cannot suppress the beacon on
--      refresh without false-positives, so the beacon is intentionally NOT
--      fired in those clients. The session stays alive via heartbeats and
--      dies when the heartbeats stop.
--   2. Browser crashes / power loss / hard kills in ANY browser skip the
--      pagehide handler entirely. Heartbeats catch these cases for both
--      modern and old browsers.
--
-- The checkout page emits POST /api/checkout/heartbeat every 10 seconds. The
-- cron job below releases soft sessions where last_heartbeat_at is older
-- than the staleness threshold (30 s). Worst-case release after close in
-- a no-beacon browser: ~30 s heartbeat threshold + up to ~60 s cron interval
-- = ~90 s. Opportunistic cleanup still gives an immediate release whenever
-- a competing customer actually contends for the variant.
-- =============================================================================

ALTER TABLE public.cart_checkout_sessions
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz NOT NULL DEFAULT now();

-- Drives the heartbeat reaper. WHERE filter keeps the index small.
CREATE INDEX IF NOT EXISTS idx_cart_checkout_sessions_heartbeat
  ON public.cart_checkout_sessions(last_heartbeat_at)
  WHERE state = 'soft';

COMMENT ON COLUMN public.cart_checkout_sessions.last_heartbeat_at IS
  'Updated every ~10s by POST /api/checkout/heartbeat while the customer is on /checkout. Drives release_stale_heartbeat_sessions cron — sessions with last_heartbeat_at < now() - 30s are treated as abandoned.';

-- ---------------------------------------------------------------------------
-- release_stale_heartbeat_sessions: releases soft sessions whose heartbeat
-- has gone stale (no ping within the last 30 seconds). Mirrors the structure
-- of reap_stale_soft_sessions — same per-session sub-block for inventory
-- release, same exception handling for already-released items.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_stale_heartbeat_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_released_count integer := 0;
  v_session record;
  v_item record;
BEGIN
  FOR v_session IN
    SELECT id, cart_id
    FROM public.cart_checkout_sessions
    WHERE state = 'soft'
      AND last_heartbeat_at < now() - interval '30 seconds'
  LOOP
    IF v_session.cart_id IS NOT NULL THEN
      FOR v_item IN
        SELECT variant_id, quantity
        FROM public.cart_items
        WHERE cart_id = v_session.cart_id
          AND variant_id IS NOT NULL
          AND quantity > 0
      LOOP
        BEGIN
          PERFORM public.release_soft(v_item.variant_id, v_item.quantity);
        EXCEPTION WHEN OTHERS THEN
          IF SQLERRM NOT LIKE '%INSUFFICIENT_SOFT_HELD%' THEN
            RAISE NOTICE 'release_stale_heartbeat_sessions: release_soft failed for variant % qty %: %',
              v_item.variant_id, v_item.quantity, SQLERRM;
          END IF;
        END;
      END LOOP;
    END IF;

    UPDATE public.cart_checkout_sessions
    SET state = 'released', updated_at = now()
    WHERE id = v_session.id
      AND state = 'soft';

    v_released_count := v_released_count + 1;
  END LOOP;

  RETURN v_released_count;
END;
$$;

COMMENT ON FUNCTION public.release_stale_heartbeat_sessions IS
  'Releases soft sessions whose last_heartbeat_at is older than 30s — heartbeat fallback for clients that didn''t fire the pagehide beacon (older browsers without Navigation API + every browser-crash case). Scheduled every minute via pg_cron; worst-case release ~90s after the heartbeats stop.';

-- ---------------------------------------------------------------------------
-- Schedule the heartbeat reaper. Wrapped in DO/EXCEPTION so the migration
-- survives projects without pg_cron — function remains callable manually.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('release-stale-heartbeat-sessions');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'release-stale-heartbeat-sessions',
    '* * * * *',
    'SELECT public.release_stale_heartbeat_sessions()'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE
    'pg_cron scheduling failed: %. release_stale_heartbeat_sessions() is still callable manually.',
    SQLERRM;
END $$;
