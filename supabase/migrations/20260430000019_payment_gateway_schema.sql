-- =============================================================================
-- wf-021 — Payment gateway schema (+ payment_transactions)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_payment_intent_id text NOT NULL UNIQUE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  amount integer NOT NULL,
  currency text NOT NULL DEFAULT 'eur',
  status text NOT NULL DEFAULT 'pending',
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  client_secret text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (amount > 0),
  CHECK (status IN ('pending', 'requires_action', 'processing', 'succeeded', 'canceled', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_payment_intents_order_id
  ON public.payment_intents(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_user_id
  ON public.payment_intents(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_status
  ON public.payment_intents(status);
CREATE INDEX IF NOT EXISTS idx_payment_intents_stripe_id
  ON public.payment_intents(stripe_payment_intent_id);

ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_intents_select_own"
  ON public.payment_intents FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_permission('manage:orders'));

-- ---------------------------------------------------------------------------
-- payment_transactions (settlement records)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_intent_id uuid NOT NULL REFERENCES public.payment_intents(id) ON DELETE CASCADE,
  stripe_charge_id text,
  amount integer NOT NULL,
  status text NOT NULL,
  failure_reason text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_payment_id
  ON public.payment_transactions(payment_intent_id);

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_transactions_select_admin"
  ON public.payment_transactions FOR SELECT TO authenticated
  USING (public.has_permission('manage:orders'));
