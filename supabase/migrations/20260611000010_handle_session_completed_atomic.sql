-- =============================================================================
-- Phase 3d — handle_session_completed_atomic.
--
-- Background:
--   The legacy handleSessionCompleted handler does FOUR separate DB
--   writes for a single Stripe checkout.session.completed event:
--     1. UPDATE payment_intents.status = 'succeeded'
--     2. UPDATE orders.payment_status = 'paid', fulfillment_status = 'confirmed'
--     3. (separately) fulfillOrder loop over order_items
--     4. INSERT audit_events
--   A 5xx between writes means Stripe retries and the payment_intents
--   guarded UPDATE no-ops (good) but the orders + fulfillOrder steps
--   may re-fire with partial state.
--
--   This RPC compresses writes 1, 2, and 4 into one transaction. The
--   inventory consume loop (fulfillOrder) stays as a SEPARATE call
--   issued from JS after this RPC succeeds, because:
--     a) fulfill_order_atomic is already its own idempotent RPC
--     b) Keeping the consume loop separate makes failure recovery
--        cleaner — the webhook can retry just the fulfill step
--        without re-running the payment_intent flip.
--
--   Idempotency:
--     - payment_intents flip is guarded by `WHERE status IN
--       ('session_pending','pending','processing')` so a retry
--       no-ops cleanly.
--     - orders flip is guarded by `WHERE payment_status = 'pending'`
--       so a retry doesn't re-flip a paid order.
--     - Audit log only emits on the FIRST successful flip (when
--       the payment_intents UPDATE actually matched a row).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_session_completed_atomic(
  p_provider            text,
  p_provider_session_id text,
  p_provider_intent_id  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_intent     public.payment_intents%ROWTYPE;
  v_pi_updated integer := 0;
BEGIN
  -- Look up payment_intent by session id
  SELECT * INTO v_intent
    FROM public.payment_intents
   WHERE stripe_checkout_session_id = p_provider_session_id;

  IF NOT FOUND THEN
    -- Unknown session id — return null so the JS layer can return
    -- {orderId: null} without raising. Stripe retries don't help here;
    -- this is a genuine miss (test event, deleted session, etc.).
    RETURN jsonb_build_object(
      'ok', true,
      'order_id', NULL,
      'first_completion', false,
      'reason', 'session_not_found'
    );
  END IF;

  -- Idempotent: already-succeeded session is a no-op success.
  IF v_intent.status = 'succeeded' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'order_id', v_intent.order_id,
      'first_completion', false,
      'reason', 'already_succeeded'
    );
  END IF;

  -- Flip payment_intents → succeeded. Guarded predicate so concurrent
  -- webhook retries can't double-flip.
  UPDATE public.payment_intents
     SET status = 'succeeded',
         updated_at = now(),
         stripe_payment_intent_id = COALESCE(p_provider_intent_id, stripe_payment_intent_id)
   WHERE id = v_intent.id
     AND status IN ('session_pending', 'pending', 'processing');
  GET DIAGNOSTICS v_pi_updated = ROW_COUNT;

  -- If the payment_intent flip didn't happen, another path got there
  -- first. Treat as idempotent no-op success (the order side will
  -- have been handled by whoever won the race).
  IF v_pi_updated = 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'order_id', v_intent.order_id,
      'first_completion', false,
      'reason', 'concurrent_completion'
    );
  END IF;

  -- Flip orders → paid + confirmed. Guarded so a re-fire after a
  -- partial completion (somehow) doesn't double-confirm.
  IF v_intent.order_id IS NOT NULL THEN
    UPDATE public.orders
       SET payment_status     = 'paid',
           fulfillment_status = 'confirmed',
           updated_at         = now()
     WHERE id = v_intent.order_id
       AND payment_status = 'pending';

    -- Audit log — emitted only on the first-completion path
    -- (guarded by v_pi_updated > 0 above) so retries don't
    -- spam the audit table.
    INSERT INTO public.audit_events (
      actor_id, actor_type, action, resource_type, resource_id, metadata
    )
    VALUES (
      NULL,
      'system',
      'payment.session.completed',
      'payment_intent',
      p_provider_session_id,
      jsonb_build_object(
        'provider', p_provider,
        'order_id', v_intent.order_id,
        'provider_intent_id', p_provider_intent_id
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_intent.order_id,
    'first_completion', true,
    'reason', NULL
  );
END;
$$;

COMMENT ON FUNCTION public.handle_session_completed_atomic(text, text, text) IS
'Atomically flips payment_intents → succeeded + orders → paid/confirmed + audit. The downstream fulfillment (inventory consume + email) stays in JS using fulfill_order_atomic. Idempotent — concurrent webhook retries safely no-op.';

REVOKE EXECUTE ON FUNCTION public.handle_session_completed_atomic(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.handle_session_completed_atomic(text, text, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
