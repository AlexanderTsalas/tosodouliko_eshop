-- =============================================================================
-- Phase 8b — Reaper functions migrated to typed SQLSTATE catches.
--
-- Background:
--   The three highest-traffic reapers — reap_stale_soft_sessions,
--   release_idle_soft_sessions, cleanup_expired_sessions_for_variant —
--   each contain `EXCEPTION WHEN OTHERS THEN ... SQLERRM LIKE
--   '%INSUFFICIENT_SOFT_HELD%' ...`. This conflates benign races
--   (the row was already released by another path) with REAL failures
--   (deadlock, lock wait, FK violation) — both look the same in logs.
--
--   Now that Phase 8a migrated `release_soft` to raise with SQLSTATE
--   'ISFTL' on the benign race, the reapers can catch precisely:
--     EXCEPTION
--       WHEN SQLSTATE 'ISFTL' THEN CONTINUE;
--       WHEN OTHERS THEN PERFORM log_system_error(...);
--
--   Non-benign exceptions now flow into public.system_errors (Phase 0)
--   where operators can query them via /admin/system-errors (Phase 10).
--
--   Lower-traffic reapers (release_stale_heartbeat_sessions,
--   release_expired_priority_holds, advance_soft_wait_queue_*,
--   collapse_soft_wait_queue_for_session, consume_priority_holds_for_checkout,
--   reconcile_orphan_soft_held) keep their string-match patterns for now —
--   the conversion is mechanical and can be done in a focused follow-up.
-- =============================================================================

-- ──── reap_stale_soft_sessions ──────────────────────────────────────────────
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
      AND expires_at IS NOT NULL
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
        EXCEPTION
          WHEN SQLSTATE 'ISFTL' THEN
            -- Benign: row already released by another path (concurrent
            -- reaper tick, opportunistic cleanup, user-driven release).
            -- Silently continue — this is the expected miss.
            CONTINUE;
          WHEN OTHERS THEN
            -- Real failure: log so it's visible in /admin/system-errors.
            -- Continue the loop so one bad row doesn't abort the whole
            -- batch (the original RAISE NOTICE pattern's intent).
            PERFORM public.log_system_error(
              'reap_stale_soft_sessions',
              'error',
              SQLSTATE,
              SQLERRM,
              'variant',
              v_item.variant_id,
              jsonb_build_object(
                'session_id', v_session.id,
                'cart_id',    v_session.cart_id,
                'qty',        v_item.quantity
              )
            );
            CONTINUE;
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

-- ──── release_idle_soft_sessions ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.release_idle_soft_sessions()
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
      AND last_interaction_at < now() - interval '30 minutes'
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
        EXCEPTION
          WHEN SQLSTATE 'ISFTL' THEN
            CONTINUE;
          WHEN OTHERS THEN
            PERFORM public.log_system_error(
              'release_idle_soft_sessions',
              'error',
              SQLSTATE,
              SQLERRM,
              'variant',
              v_item.variant_id,
              jsonb_build_object(
                'session_id', v_session.id,
                'cart_id',    v_session.cart_id,
                'qty',        v_item.quantity
              )
            );
            CONTINUE;
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

-- ──── cleanup_expired_sessions_for_variant ──────────────────────────────────
-- Inline cleanup called from hold_soft / effective_available_for. Most
-- frequently-invoked of the three because it fires on every contended
-- click + every catalog availability read.
CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions_for_variant(
  p_variant_id uuid
)
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
  IF p_variant_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_session IN
    SELECT s.id, s.cart_id
    FROM public.cart_checkout_sessions s
    WHERE s.state = 'soft'
      AND (
        s.expires_at < now()
        OR s.last_heartbeat_at < now() - interval '30 seconds'
      )
      AND s.cart_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.cart_items ci
        WHERE ci.cart_id = s.cart_id
          AND ci.variant_id = p_variant_id
          AND ci.quantity > 0
      )
  LOOP
    FOR v_item IN
      SELECT variant_id, quantity
      FROM public.cart_items
      WHERE cart_id = v_session.cart_id
        AND variant_id IS NOT NULL
        AND quantity > 0
    LOOP
      BEGIN
        PERFORM public.release_soft(v_item.variant_id, v_item.quantity);
      EXCEPTION
        WHEN SQLSTATE 'ISFTL' THEN
          CONTINUE;
        WHEN OTHERS THEN
          PERFORM public.log_system_error(
            'cleanup_expired_sessions_for_variant',
            'error',
            SQLSTATE,
            SQLERRM,
            'variant',
            v_item.variant_id,
            jsonb_build_object(
              'triggering_variant_id', p_variant_id,
              'session_id',            v_session.id,
              'cart_id',               v_session.cart_id,
              'qty',                   v_item.quantity
            )
          );
          CONTINUE;
      END;
    END LOOP;

    UPDATE public.cart_checkout_sessions
    SET state = 'released', updated_at = now()
    WHERE id = v_session.id;

    v_released_count := v_released_count + 1;
  END LOOP;

  RETURN v_released_count;
END;
$$;

NOTIFY pgrst, 'reload schema';
