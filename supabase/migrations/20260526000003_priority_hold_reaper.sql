-- =============================================================================
-- Phase 4A — Priority-hold reaper + wire queue advancement into existing
-- soft-release paths.
--
-- Two pieces:
--
-- 1. release_expired_priority_holds() — every minute via pg_cron. Finds
--    priority_holds rows where expires_at < now() AND consumed_at IS NULL,
--    releases the inventory back to quantity_available, and for
--    soft_wait_promotion-source rows advances the queue (next FIFO waiter
--    gets a fresh 5-minute promotion).
--
-- 2. Update the existing soft-release paths to call
--    advance_soft_wait_queue_for_session after a session is released:
--      - reap_stale_soft_sessions (wall-clock expiry)
--      - release_stale_heartbeat_sessions (heartbeat staleness)
--      - release_soft_session (explicit, used by Phase 10 admin tooling)
--
-- These are the moments the wait queue should advance — a Phase 2 session
-- ends and its inventory becomes available. Without this wiring, the
-- waiters would only ever get notified by the priority-hold reaper, which
-- never runs because there's no priority_hold to expire.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- release_expired_priority_holds
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_expired_priority_holds()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_released_count integer := 0;
  v_hold record;
BEGIN
  FOR v_hold IN
    SELECT id, variant_id, quantity, source
    FROM public.priority_holds
    WHERE expires_at < now()
      AND consumed_at IS NULL
  LOOP
    BEGIN
      PERFORM public.release_priority(v_hold.variant_id, v_hold.quantity);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%INSUFFICIENT_PRIORITY_HELD%' THEN
        RAISE NOTICE 'release_expired_priority_holds: release_priority failed for hold % variant % qty %: %',
          v_hold.id, v_hold.variant_id, v_hold.quantity, SQLERRM;
      END IF;
    END;

    -- Mark consumed_at (using the same column for "terminal" — the reaper
    -- WHERE clause filters on it). The actual semantic is "no longer
    -- active" regardless of whether the customer consumed or it expired.
    UPDATE public.priority_holds
    SET consumed_at = now()
    WHERE id = v_hold.id
      AND consumed_at IS NULL;

    -- For soft_wait_promotion source: try to advance the queue. This
    -- promotes the next FIFO waiter in the same (session, variant) bucket
    -- if any remain.
    IF v_hold.source = 'soft_wait_promotion' THEN
      BEGIN
        PERFORM public.advance_soft_wait_queue_after_priority_expiry(v_hold.id);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'release_expired_priority_holds: queue-advance failed for hold %: %',
          v_hold.id, SQLERRM;
      END;
    END IF;

    v_released_count := v_released_count + 1;
  END LOOP;

  RETURN v_released_count;
END;
$$;

COMMENT ON FUNCTION public.release_expired_priority_holds IS
  'Periodic cleanup: releases inventory from priority_holds rows whose 5-min (soft-wait promotion) or 30-min (wishlist notification) window has passed. For soft-wait-promotion sources, also advances the queue so the next waiter gets their turn.';

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('release-expired-priority-holds');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'release-expired-priority-holds',
    '* * * * *',
    'SELECT public.release_expired_priority_holds()'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE
    'pg_cron scheduling failed: %. release_expired_priority_holds() is still callable manually.',
    SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- Wire queue advancement into existing soft-release paths.
-- The functions below are re-defined verbatim except for the addition of an
-- inline advance_soft_wait_queue_for_session call at the right moment.
-- ---------------------------------------------------------------------------

-- reap_stale_soft_sessions: now advances the queue for each released session.
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
            RAISE NOTICE 'reap_stale_soft_sessions: release_soft failed for variant % qty %: %',
              v_item.variant_id, v_item.quantity, SQLERRM;
          END IF;
        END;
      END LOOP;
    END IF;

    UPDATE public.cart_checkout_sessions
    SET state = 'released', updated_at = now()
    WHERE id = v_session.id;

    -- Phase 4A: promote the first-in-queue waiter for any variant this
    -- session was holding. Inline so the next customer can act immediately
    -- without waiting for the priority reaper tick.
    BEGIN
      PERFORM public.advance_soft_wait_queue_for_session(v_session.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'reap_stale_soft_sessions: queue advance failed for session %: %',
        v_session.id, SQLERRM;
    END;

    v_released_count := v_released_count + 1;
  END LOOP;

  RETURN v_released_count;
END;
$$;

-- release_stale_heartbeat_sessions: same wire-in.
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

    BEGIN
      PERFORM public.advance_soft_wait_queue_for_session(v_session.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'release_stale_heartbeat_sessions: queue advance failed for session %: %',
        v_session.id, SQLERRM;
    END;

    v_released_count := v_released_count + 1;
  END LOOP;

  RETURN v_released_count;
END;
$$;

-- release_soft_session: same wire-in.
CREATE OR REPLACE FUNCTION public.release_soft_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session record;
  v_item record;
BEGIN
  SELECT id, cart_id, state
  INTO v_session
  FROM public.cart_checkout_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_session.state <> 'soft' THEN
    RETURN false;
  END IF;

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
          RAISE NOTICE 'release_soft_session: release_soft failed for variant % qty %: %',
            v_item.variant_id, v_item.quantity, SQLERRM;
        END IF;
      END;
    END LOOP;
  END IF;

  UPDATE public.cart_checkout_sessions
  SET state = 'released', updated_at = now()
  WHERE id = p_session_id
    AND state = 'soft';

  BEGIN
    PERFORM public.advance_soft_wait_queue_for_session(p_session_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'release_soft_session: queue advance failed for session %: %',
      p_session_id, SQLERRM;
  END;

  RETURN true;
END;
$$;
