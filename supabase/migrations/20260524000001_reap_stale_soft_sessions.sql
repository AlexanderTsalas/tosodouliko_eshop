-- =============================================================================
-- Soft contention reaper (Phase 8 of impl plan).
--
-- Finds cart_checkout_sessions rows in state='soft' whose expires_at has
-- passed and:
--   1. Releases each cart_item's quantity from quantity_soft_held back to
--      quantity_available (via the release_soft RPC).
--   2. Marks the session row state='released'.
--
-- Scheduled to run every minute via pg_cron when the extension is available.
-- If pg_cron is unavailable (some Supabase tiers / non-Supabase deployments),
-- the function is still callable manually:
--   SELECT public.reap_stale_soft_sessions();
--
-- The function is idempotent: a session already in state='released' won't be
-- matched by the WHERE clause, and release_soft will raise INSUFFICIENT_SOFT_HELD
-- if the underlying counter has already been zeroed — caught in the inner
-- EXCEPTION block so one bad release doesn't abort the whole batch.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.reap_stale_soft_sessions()
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
      AND expires_at < now()
  LOOP
    -- Release every cart item's quantity from soft_held back to available.
    -- We use a sub-block so one item's release failure doesn't abort the
    -- whole session (rare but possible if state has drifted).
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
          -- INSUFFICIENT_SOFT_HELD is benign here: the hold was already
          -- released by some other path (e.g., a parallel placeOrder that
          -- raced past the reaper). Log everything else.
          IF SQLERRM NOT LIKE '%INSUFFICIENT_SOFT_HELD%' THEN
            RAISE NOTICE 'reap_stale_soft_sessions: release_soft failed for variant % qty %: %',
              v_item.variant_id, v_item.quantity, SQLERRM;
          END IF;
        END;
      END LOOP;
    END IF;

    UPDATE public.cart_checkout_sessions
    SET state = 'released', updated_at = now()
    WHERE id = v_session.id;

    v_released_count := v_released_count + 1;
  END LOOP;

  RETURN v_released_count;
END;
$$;

COMMENT ON FUNCTION public.reap_stale_soft_sessions IS
  'Periodic cleanup: releases inventory holds and marks state=released on cart_checkout_sessions rows whose 15-minute soft-contention timer has passed. Scheduled via pg_cron when available; callable manually otherwise.';

-- Schedule it to run every minute via pg_cron. Wrapped in a DO block so the
-- migration doesn't abort if pg_cron isn't enabled on this project — the
-- reaper function above still exists and can be called manually.
DO $$
BEGIN
  -- Unschedule any previous instance with the same name (idempotent re-runs).
  BEGIN
    PERFORM cron.unschedule('reap-stale-soft-sessions');
  EXCEPTION WHEN OTHERS THEN
    -- Wasn't scheduled before; ignore.
    NULL;
  END;

  -- Schedule fresh.
  PERFORM cron.schedule(
    'reap-stale-soft-sessions',
    '* * * * *',
    'SELECT public.reap_stale_soft_sessions()'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE
    'pg_cron scheduling failed: %. The reap_stale_soft_sessions() function is still callable manually.',
    SQLERRM;
END $$;
