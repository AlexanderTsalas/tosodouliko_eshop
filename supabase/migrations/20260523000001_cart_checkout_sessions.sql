-- =============================================================================
-- cart_checkout_sessions — tracks the soft contention phase of the
-- inventory-contention design (Phase 2 of the spec, Phase 2 of the impl plan).
--
-- A row is created when the customer clicks "Ολοκλήρωση παραγγελίας" in the
-- cart drawer/page; this is the moment they signal real intent to buy. The
-- session holds inventory in quantity_soft_held for up to 15 minutes (the
-- wall-clock expiry timer is the upper bound; a reaper releases stale
-- sessions in Phase 8 of the impl plan).
--
-- The session transitions:
--   - soft       — customer is on the checkout page filling out the form
--   - hard       — customer clicked submit, promote_soft_to_reserved succeeded
--   - completed  — payment succeeded (Stripe webhook or COD lifecycle)
--   - released   — customer abandoned, session expired, or any failure path
--
-- Naming note: this internal table is `cart_checkout_sessions` rather than
-- `checkout_sessions` to avoid collision with Stripe's "Checkout Sessions"
-- terminology used elsewhere in the codebase (see Phase 0 of impl plan).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.cart_checkout_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  cart_id         uuid REFERENCES public.carts(id) ON DELETE SET NULL,
  state           text NOT NULL DEFAULT 'soft'
                    CHECK (state IN ('soft', 'hard', 'completed', 'released')),
  -- Linked when state transitions to 'hard' (placeOrder creates the order).
  order_id        uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  -- Linked when state transitions to 'hard' (createCheckoutSession persists
  -- the payment row).
  payment_intent_id uuid REFERENCES public.payment_intents(id) ON DELETE SET NULL,
  -- For 'soft' state: created_at + 15 min. The reaper (Phase 8) reads this
  -- column to find stale soft sessions and release them.
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cart_checkout_sessions_customer
  ON public.cart_checkout_sessions(customer_id)
  WHERE state IN ('soft', 'hard');

CREATE INDEX IF NOT EXISTS idx_cart_checkout_sessions_cart
  ON public.cart_checkout_sessions(cart_id)
  WHERE state = 'soft';

-- Drives the soft-session reaper job (Phase 8).
CREATE INDEX IF NOT EXISTS idx_cart_checkout_sessions_soft_expires
  ON public.cart_checkout_sessions(expires_at)
  WHERE state = 'soft';

ALTER TABLE public.cart_checkout_sessions ENABLE ROW LEVEL SECURITY;

-- Customers can read their own sessions.
CREATE POLICY "cart_checkout_sessions_select_own"
  ON public.cart_checkout_sessions FOR SELECT TO authenticated
  USING (
    customer_id IN (
      SELECT id FROM public.customers WHERE auth_user_id = auth.uid()
    )
  );

-- All writes are via the service role from server actions. Admin-permission
-- holders can also read for support / debugging purposes.
CREATE POLICY "cart_checkout_sessions_admin_select"
  ON public.cart_checkout_sessions FOR SELECT TO authenticated
  USING (public.has_permission('manage:orders'));

COMMENT ON TABLE public.cart_checkout_sessions IS
  'Per-customer soft-contention sessions. Created at "Ολοκλήρωση παραγγελίας" click in cart; transitions to ''hard'' when the customer submits the checkout form (placeOrder).';
