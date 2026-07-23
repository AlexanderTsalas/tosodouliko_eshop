-- =============================================================================
-- Phase 4C — Supabase Realtime CDC for cart/contention surfaces.
--
-- Adds the contention-related tables to the `supabase_realtime` publication
-- so the Supabase Realtime server emits change events to subscribed clients
-- on INSERT/UPDATE/DELETE. RLS still applies at event-delivery time: a client
-- only receives events for rows their RLS policies allow them to read.
--
-- For our use:
--   - soft_waits / priority_holds — clients see only their own customer's
--     rows (see the SELECT policies in 20260526000001).
--   - cart_items                  — clients see only their own cart's rows
--     (existing RLS on cart_items).
--
-- The CartDrawer uses these subscriptions to refetch + repaint when:
--   - Their soft_wait gets promoted (UPDATE on soft_waits with promoted_at)
--   - A priority_hold is granted in their name (INSERT on priority_holds)
--   - Their cart_item is server-deleted (DELETE on cart_items → collapse modal)
-- =============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.soft_waits;
ALTER PUBLICATION supabase_realtime ADD TABLE public.priority_holds;

-- cart_items may already be in the publication from earlier work. The
-- IF NOT EXISTS pattern for publication tables isn't supported in Postgres,
-- so we wrap the ADD in a DO block that swallows the duplicate error.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.cart_items;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
