-- =============================================================================
-- collapse_notifications — durable inbox row inserted whenever a holder's
-- payment causes a soft-wait queue to collapse. Waiters' browsers subscribe
-- to INSERT events on this table (Realtime postgres_changes) and pop a modal
-- listing the items they lost.
--
-- Why a dedicated table instead of reusing soft_waits DELETE events:
--   * DELETE through CDC requires REPLICA IDENTITY FULL on the source table
--     AND careful handling of filter-on-OLD, both of which proved fragile in
--     practice — events would silently fail to dispatch.
--   * INSERT events always carry the full NEW row. RLS + filter behavior is
--     the well-trodden path. Trivial to debug.
--   * Self-actions (a waiter voluntarily leaving the queue, cart_item removal)
--     don't write here. Presence of a row == "the holder paid; your items are
--     gone." No state-disambiguation logic in the client.
--   * The row also acts as an inbox: if the customer is offline at the time
--     of collapse, they see the modal on next page load via a one-shot fetch
--     of unacknowledged rows.
--
-- Lifecycle:
--   INSERT — placeOrder.ts inserts one row per (waiter, lost variant) after
--            calling collapse_soft_wait_queue_for_session.
--   acknowledged_at — set by acknowledgeCollapseNotifications when the
--            customer dismisses the modal or adds the items to wishlist.
--            Acknowledged rows are retained for audit; a future cron can
--            purge rows older than ~30 days.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.collapse_notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  variant_id      uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  -- Denormalized at insert so the modal renders even if the product is
  -- later renamed / unpublished. Cheap; the row is short-lived.
  product_name    text NOT NULL,
  product_slug    text NOT NULL,
  variant_label   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz
);

-- Drives the "fetch my unacknowledged notifications on page load" query.
CREATE INDEX IF NOT EXISTS idx_collapse_notifications_customer_unacked
  ON public.collapse_notifications(customer_id, created_at DESC)
  WHERE acknowledged_at IS NULL;

ALTER TABLE public.collapse_notifications ENABLE ROW LEVEL SECURITY;

-- Customers see their own rows. The insert path uses the service-role
-- admin client (no RLS), so no INSERT policy is needed.
CREATE POLICY "collapse_notifications_select_own"
  ON public.collapse_notifications FOR SELECT TO authenticated
  USING (
    customer_id IN (
      SELECT id FROM public.customers WHERE auth_user_id = auth.uid()
    )
  );

-- Customers can mark their own rows acknowledged.
CREATE POLICY "collapse_notifications_update_own"
  ON public.collapse_notifications FOR UPDATE TO authenticated
  USING (
    customer_id IN (
      SELECT id FROM public.customers WHERE auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    customer_id IN (
      SELECT id FROM public.customers WHERE auth_user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.collapse_notifications IS
  'Inbox of "your queued items were sold" events. Inserted by placeOrder when collapse_soft_wait_queue_for_session removes the customer''s cart items. Consumed by CollapseWatcher via Realtime INSERT subscription, plus a backfill fetch on page load.';

-- Add to the supabase_realtime publication so postgres_changes delivers
-- INSERT events to the client.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.collapse_notifications;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
