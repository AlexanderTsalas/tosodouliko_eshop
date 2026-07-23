-- =============================================================================
-- Migrate the payment flow from Stripe Payment Intents to Stripe Checkout
-- Sessions. The `payment_intents` table is extended (not replaced) with
-- session-tracking columns so historical Payment Intent rows remain queryable.
--
-- The legacy `stripe_payment_intent_id` column stays — for Stripe Checkout
-- Sessions a Payment Intent is still created under the hood, so we keep both
-- ids on the same row for traceability.
-- =============================================================================

ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS checkout_session_url text,
  ADD COLUMN IF NOT EXISTS checkout_session_expires_at timestamptz;

-- The original `stripe_payment_intent_id` column is NOT NULL. For the
-- Checkout Sessions path the Payment Intent id isn't known until the session
-- actually starts processing, so relax the constraint.
ALTER TABLE public.payment_intents
  ALTER COLUMN stripe_payment_intent_id DROP NOT NULL;

-- Replace the old status CHECK with one that includes session-state values.
-- The original was defined inline without an explicit name; find it
-- dynamically before dropping.
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.payment_intents'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%IN%';
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.payment_intents DROP CONSTRAINT %I',
      v_constraint_name
    );
  END IF;
END $$;

ALTER TABLE public.payment_intents
  ADD CONSTRAINT payment_intents_status_check
  CHECK (status IN (
    'pending',
    'requires_action',
    'processing',
    'succeeded',
    'canceled',
    'failed',
    'session_pending',
    'session_expired'
  ));

CREATE INDEX IF NOT EXISTS idx_payment_intents_checkout_session_id
  ON public.payment_intents(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

COMMENT ON COLUMN public.payment_intents.stripe_checkout_session_id IS
  'Stripe Checkout Session id (cs_*). Set when an order checkout uses the Sessions API. Companion to stripe_payment_intent_id, which is set later when the session starts processing.';
COMMENT ON COLUMN public.payment_intents.checkout_session_url IS
  'URL the customer is redirected to in order to complete payment on Stripe-hosted checkout.';
COMMENT ON COLUMN public.payment_intents.checkout_session_expires_at IS
  'When the Checkout Session expires (Stripe-controlled, 30 min from creation by default). Hard-contention release happens when this triggers checkout.session.expired.';
