-- =============================================================================
-- Signup-detour timer extension.
--
-- When a guest in the middle of checkout picks "Δημιουργία λογαριασμού" at
-- the cart-click prompt, they leave the page to fill the signup form. If
-- the soft session is contended (waiters behind), the contention timer is
-- ticking — they could lose their turn just to the detour overhead.
--
-- This migration adds:
--   * A `signup_detour_at` column on cart_checkout_sessions (one-shot
--     marker; presence = "this session has been bumped already").
--   * An RPC `extend_for_signup_detour(session_id)` that adds 5 minutes to
--     `expires_at` and stamps `signup_detour_at` — but only once per
--     session (idempotent), and only if `expires_at` is currently set
--     (uncontended sessions have NULL expires_at; no need to extend, but
--     we still stamp the marker so the UI knows the detour happened).
--
-- Baseline contention timer is 15 min (apply_contention_timer); the +5
-- bump caps the maximum at 20 min total. Communicated to waiters as the
-- upper bound of their wait window.
-- =============================================================================

ALTER TABLE public.cart_checkout_sessions
  ADD COLUMN IF NOT EXISTS signup_detour_at timestamptz;

COMMENT ON COLUMN public.cart_checkout_sessions.signup_detour_at IS
  'Set when the customer picks "Δημιουργία λογαριασμού" at the cart-click prompt. One-shot — extend_for_signup_detour is a no-op if non-NULL. UI uses this to label the waiter banner ("ο πελάτης κάνει εγγραφή").';

CREATE OR REPLACE FUNCTION public.extend_for_signup_detour(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state text;
  v_expires_at timestamptz;
  v_marker timestamptz;
BEGIN
  SELECT state, expires_at, signup_detour_at
    INTO v_state, v_expires_at, v_marker
    FROM public.cart_checkout_sessions
   WHERE id = p_session_id;

  IF NOT FOUND OR v_state != 'soft' OR v_marker IS NOT NULL THEN
    -- Either no such session, not in soft state, or already bumped once.
    -- The "already bumped" branch is the idempotency cap — second click
    -- in the same flow is a no-op so the waiter timer doesn't bounce.
    RETURN false;
  END IF;

  UPDATE public.cart_checkout_sessions
     SET expires_at = CASE
                        WHEN expires_at IS NULL THEN NULL
                        ELSE expires_at + interval '5 minutes'
                      END,
         signup_detour_at = now(),
         last_interaction_at = now(),
         updated_at = now()
   WHERE id = p_session_id;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.extend_for_signup_detour IS
  'One-shot per session: adds 5 min to expires_at (if set) and stamps signup_detour_at to mark that the holder has detoured for signup. Idempotent — a repeat call is a no-op. Returns true on the first successful bump, false on subsequent attempts.';

GRANT EXECUTE ON FUNCTION public.extend_for_signup_detour(uuid) TO authenticated, service_role;

-- Add to realtime publication so waiter UIs can react to the marker
-- appearing (e.g., switch banner copy). cart_checkout_sessions was added
-- in 20260601000003; the column update events flow with the row already.
