-- =============================================================================
-- Extend opportunistic cleanup to also catch stale-heartbeat sessions.
--
-- Background: we abandoned the pagehide-beacon release path because no
-- browser-side signal can reliably distinguish refresh from close (Chrome's
-- Navigation API `navigate` event does NOT fire on cross-document F5 reload,
-- and pagehide alone has the refresh-vs-close ambiguity). Liveness now comes
-- exclusively from heartbeats (POST /api/checkout/heartbeat every 10s).
--
-- The heartbeat-staleness cron runs every ~60s. That's fine for uncontended
-- abandonment, but a customer who clicks "Ολοκλήρωση παραγγελίας" for an
-- item another customer just abandoned shouldn't have to wait up to 60s for
-- the cron to catch up. Opportunistic cleanup already handles this pattern
-- for *wall-clock-expired* sessions; this migration extends it to also handle
-- *heartbeat-stale* sessions, so contended releases stay instant.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions_for_variant(
  p_variant_id uuid
)
RETURNS integer
LANGUAGE plpgsql
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
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%INSUFFICIENT_SOFT_HELD%' THEN
          RAISE NOTICE 'cleanup_expired_sessions_for_variant: release_soft failed for variant % qty %: %',
            v_item.variant_id, v_item.quantity, SQLERRM;
        END IF;
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

COMMENT ON FUNCTION public.cleanup_expired_sessions_for_variant IS
  'Inline cleanup helper: releases any soft sessions that touch this variant and are either wall-clock-expired OR have a stale heartbeat (>30s since last ping). Called from hold_soft / effective_available_for so contended customers don''t wait for the cron tick when another customer has abandoned the item.';
