-- =============================================================================
-- Realtime delivery fix for the holder's contention banner.
--
-- Problem 1: cart_checkout_sessions was never added to the supabase_realtime
-- publication, so UPDATE events on the session row (expires_at flipping
-- between NULL and a deadline as the queue grows/empties) never reach the
-- holder's browser. The contention banner's session-row subscription was
-- silent — only refreshing on full page reload.
--
-- Problem 2 (handled in code, not here): the soft_waits SELECT RLS scopes
-- rows to the customer. The holder can't see the waiters' rows directly,
-- so a client-side count() returns 0 for non-admin holders. We route the
-- waiter count through a server action that uses the admin client.
-- =============================================================================

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.cart_checkout_sessions;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
