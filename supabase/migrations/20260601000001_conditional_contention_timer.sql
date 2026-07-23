-- =============================================================================
-- Conditional contention timer + idle backstop.
--
-- Before: every checkout_session got expires_at = created_at + 15 min, the
-- reaper enforced that uniformly, and unrelated holders timed out even with
-- no other shopper waiting for the same inventory.
--
-- After: expires_at is NULL by default. It's only set when at least one
-- soft_wait queue row exists behind the session (contention has begun). When
-- the queue goes from 0 → 1 we set expires_at = now() + 15 min; when it goes
-- back to 0 we clear it. The reapers ignore rows with NULL expires_at.
--
-- A separate 30-minute idle backstop catches sessions left open with no
-- interaction (mouse/keys/scroll) even when no one is waiting. The frontend
-- bumps last_interaction_at on user events; the new reaper releases sessions
-- where last_interaction_at < now() - 30 min.
--
-- Heartbeat-based release (existing) still applies regardless.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Schema changes
-- ---------------------------------------------------------------------------

ALTER TABLE public.cart_checkout_sessions
  ALTER COLUMN expires_at DROP NOT NULL;

ALTER TABLE public.cart_checkout_sessions
  ADD COLUMN IF NOT EXISTS last_interaction_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.cart_checkout_sessions.expires_at IS
  'Set to now() + 15 min ONLY when a soft_wait row appears behind this session (contention begins). Cleared back to NULL when the queue empties. NULL = uncontended, no expiry.';

COMMENT ON COLUMN public.cart_checkout_sessions.last_interaction_at IS
  'Updated by the frontend on real user activity (clicks, keypresses, scrolls — throttled). The 30-min idle reaper releases sessions whose interaction is older than this, regardless of contention or heartbeat.';

CREATE INDEX IF NOT EXISTS idx_cart_checkout_sessions_interaction
  ON public.cart_checkout_sessions(last_interaction_at)
  WHERE state = 'soft';

-- ---------------------------------------------------------------------------
-- Waiter presence — needed to detect abandoned waiters so the holder's
-- contention timer can clear (per spec: User B abandons → A's timer ends).
-- ---------------------------------------------------------------------------

ALTER TABLE public.soft_waits
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_soft_waits_last_seen
  ON public.soft_waits(last_seen_at)
  WHERE promoted_at IS NULL;

COMMENT ON COLUMN public.soft_waits.last_seen_at IS
  'Updated by the waiter''s cart page on a regular ping (every ~30s). If older than ~2 minutes, the waiter is treated as abandoned and their queue row is removed by the cleanup cron.';

-- ---------------------------------------------------------------------------
-- 2. Helper function: apply_contention_timer(session_id)
--    Reads the current soft_wait queue length for the session and adjusts
--    expires_at accordingly. Idempotent.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_contention_timer(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pending_count integer;
  v_current_expires_at timestamptz;
BEGIN
  SELECT count(*)
    INTO v_pending_count
    FROM public.soft_waits
   WHERE checkout_session_id = p_session_id
     AND promoted_at IS NULL;

  SELECT expires_at INTO v_current_expires_at
    FROM public.cart_checkout_sessions
   WHERE id = p_session_id
     AND state = 'soft';

  IF NOT FOUND THEN
    RETURN; -- session not in soft state, nothing to do
  END IF;

  IF v_pending_count > 0 AND v_current_expires_at IS NULL THEN
    -- Queue went 0 → ≥1 since last call: start the 15-minute clock.
    UPDATE public.cart_checkout_sessions
       SET expires_at = now() + interval '15 minutes',
           updated_at = now()
     WHERE id = p_session_id;
  ELSIF v_pending_count = 0 AND v_current_expires_at IS NOT NULL THEN
    -- Queue emptied: clear the contention clock (uncontended again).
    UPDATE public.cart_checkout_sessions
       SET expires_at = NULL,
           updated_at = now()
     WHERE id = p_session_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.apply_contention_timer IS
  'Sets expires_at on a soft checkout_session to now()+15min when waiters appear, clears it back to NULL when the queue empties. Call after any insert/delete on soft_waits.';

GRANT EXECUTE ON FUNCTION public.apply_contention_timer(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Update existing expires_at reaper: skip NULL expires_at
-- ---------------------------------------------------------------------------

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
      AND expires_at IS NOT NULL          -- contention-driven only
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

    v_released_count := v_released_count + 1;
  END LOOP;

  RETURN v_released_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. New reaper: idle-30-min release
--    Releases soft sessions whose last_interaction_at is older than 30 min,
--    regardless of contention. Belt-and-suspenders against parked tabs.
-- ---------------------------------------------------------------------------

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
        EXCEPTION WHEN OTHERS THEN
          IF SQLERRM NOT LIKE '%INSUFFICIENT_SOFT_HELD%' THEN
            RAISE NOTICE 'release_idle_soft_sessions: release_soft failed for variant % qty %: %',
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

COMMENT ON FUNCTION public.release_idle_soft_sessions IS
  'Releases soft sessions with no user interaction in the last 30 minutes. Idle backstop independent of contention or heartbeat.';

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('release-idle-soft-sessions');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'release-idle-soft-sessions',
    '* * * * *',
    'SELECT public.release_idle_soft_sessions()'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE
    'pg_cron scheduling failed: %. release_idle_soft_sessions() is still callable manually.',
    SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Waiter presence cleanup
--    Deletes soft_waits whose last_seen_at is older than 2 minutes. After
--    each delete, calls apply_contention_timer for the affected parent
--    session so the holder's clock clears if the queue is now empty.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reap_abandoned_soft_waits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer := 0;
  v_wait record;
  v_affected_sessions uuid[] := ARRAY[]::uuid[];
  v_session_id uuid;
BEGIN
  FOR v_wait IN
    SELECT id, checkout_session_id
    FROM public.soft_waits
    WHERE promoted_at IS NULL
      AND last_seen_at < now() - interval '2 minutes'
  LOOP
    DELETE FROM public.soft_waits WHERE id = v_wait.id;
    v_affected_sessions := array_append(v_affected_sessions, v_wait.checkout_session_id);
    v_count := v_count + 1;
  END LOOP;

  -- Recompute contention timers once per affected session.
  FOR v_session_id IN
    SELECT DISTINCT s FROM unnest(v_affected_sessions) AS s
  LOOP
    PERFORM public.apply_contention_timer(v_session_id);
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.reap_abandoned_soft_waits IS
  'Deletes soft_waits rows whose customer hasn''t pinged last_seen_at in >2 min, then refreshes the parent sessions'' contention timers so abandoned waiters don''t keep the holder''s clock running.';

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('reap-abandoned-soft-waits');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'reap-abandoned-soft-waits',
    '* * * * *',
    'SELECT public.reap_abandoned_soft_waits()'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE
    'pg_cron scheduling failed: %. reap_abandoned_soft_waits() is still callable manually.',
    SQLERRM;
END $$;
