-- =============================================================================
-- Phase 4A — Soft-wait queue + priority holds (data model).
--
-- Two new tables introduced by the inventory-contention spec §7 + §10:
--
-- soft_waits   — FIFO queue rows added when a customer chooses "Add to cart
--                and wait" on the Phase 3 contention modal. Lives only as
--                long as the original soft-holding session it's waiting on.
--                No inventory is held by these rows; they're a queue position
--                marker. When the original session releases, the first-in
--                soft_wait is promoted to a priority_hold.
--
-- priority_holds — 5-minute (soft-wait promotion) or 30-minute (wishlist
--                  notification) exclusive holds in a specific customer's
--                  name. Inventory moves to quantity_priority_held while
--                  the hold is alive. Reaper releases on expiry; customer
--                  consumes by advancing to checkout for the held items.
--
-- The `quantity_priority_held` column on inventory_items already exists from
-- 20260522000001_inventory_contention_columns.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- soft_waits
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.soft_waits (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The soft-holding session the waiter is queued behind. When this session
  -- transitions to 'released' or 'hard' (Phase 3), all soft_waits for it
  -- are resolved (promoted or collapsed). CASCADE so cleanup happens with
  -- the session row.
  checkout_session_id  uuid NOT NULL
                         REFERENCES public.cart_checkout_sessions(id) ON DELETE CASCADE,
  customer_id          uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  cart_item_id         uuid NOT NULL REFERENCES public.cart_items(id) ON DELETE CASCADE,
  variant_id           uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  quantity             integer NOT NULL CHECK (quantity > 0),
  -- Set when this wait was promoted to a priority_hold. NULL means still
  -- pending in queue.
  promoted_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- A customer can only have one pending wait per (session, variant) — the
  -- contention modal's "Add to cart and wait" is idempotent on retry.
  UNIQUE (checkout_session_id, customer_id, variant_id)
);

-- Drives FIFO promotion: find the oldest pending wait for a (session, variant).
CREATE INDEX IF NOT EXISTS idx_soft_waits_session_variant_fifo
  ON public.soft_waits(checkout_session_id, variant_id, created_at)
  WHERE promoted_at IS NULL;

-- Customer's queue memberships (for cart-page badge rendering).
CREATE INDEX IF NOT EXISTS idx_soft_waits_customer_pending
  ON public.soft_waits(customer_id)
  WHERE promoted_at IS NULL;

ALTER TABLE public.soft_waits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "soft_waits_select_own"
  ON public.soft_waits FOR SELECT TO authenticated
  USING (
    customer_id IN (
      SELECT id FROM public.customers WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "soft_waits_admin_select"
  ON public.soft_waits FOR SELECT TO authenticated
  USING (public.has_permission('manage:orders'));

COMMENT ON TABLE public.soft_waits IS
  'Phase 4 queue rows: customers who chose "Add to cart and wait" on the contention modal. Resolved when the parent cart_checkout_sessions row transitions out of state=soft.';

-- ---------------------------------------------------------------------------
-- priority_holds
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.priority_holds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id    uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  customer_id   uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  quantity      integer NOT NULL CHECK (quantity > 0),
  source        text NOT NULL
                  CHECK (source IN ('soft_wait_promotion', 'wishlist_notification')),
  granted_at    timestamptz NOT NULL DEFAULT now(),
  -- soft_wait_promotion: 5 min. wishlist_notification: 30 min. Set by caller.
  expires_at    timestamptz NOT NULL,
  -- Set when the customer has committed to checkout for this hold (entered
  -- placeOrder). Once non-null the reaper ignores the row.
  consumed_at   timestamptz,
  -- Source pointer back to the originating soft_wait row (for promotion-
  -- chain advancement). NULL for wishlist_notification source.
  origin_soft_wait_id uuid REFERENCES public.soft_waits(id) ON DELETE SET NULL
);

-- Drives the priority-hold reaper.
CREATE INDEX IF NOT EXISTS idx_priority_holds_active_expires
  ON public.priority_holds(expires_at)
  WHERE consumed_at IS NULL;

-- Customer's active holds (used by startCheckoutSession to detect priority
-- holds and consume them in place of hold_soft).
CREATE INDEX IF NOT EXISTS idx_priority_holds_customer_active
  ON public.priority_holds(customer_id, variant_id)
  WHERE consumed_at IS NULL;

ALTER TABLE public.priority_holds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "priority_holds_select_own"
  ON public.priority_holds FOR SELECT TO authenticated
  USING (
    customer_id IN (
      SELECT id FROM public.customers WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "priority_holds_admin_select"
  ON public.priority_holds FOR SELECT TO authenticated
  USING (public.has_permission('manage:orders'));

COMMENT ON TABLE public.priority_holds IS
  'Phase 4 + Phase 6 exclusive holds: a specific customer gets 5 minutes (soft-wait promotion) or 30 minutes (wishlist notification) to act on inventory granted in their name. Inventory sits in quantity_priority_held during the hold.';
