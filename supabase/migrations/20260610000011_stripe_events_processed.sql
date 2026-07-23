-- =============================================================================
-- Webhook event-dedup table for Stripe.
--
-- Background:
--   Stripe can deliver the same webhook event MORE THAN ONCE — duplicate
--   delivery is part of their at-least-once retry guarantee. Today the
--   handlers are status-guarded (e.g. handleSessionCompleted short-circuits
--   if intent.status is already 'succeeded'), but those guards aren't
--   atomic with the work they protect. A duplicate that races the first
--   delivery can squeak past the status check and trigger
--   INSUFFICIENT_RESERVED on consume_reservation.
--
--   Plus: with the recent fix to return 5xx on handler errors so Stripe
--   retries, this kind of "harmless duplicate" becomes more common —
--   any 5xx return immediately gets retried.
--
-- This table:
--   - Records every Stripe event_id we've processed (or failed
--     non-retriably) with a timestamp.
--   - Stripe event_ids are globally unique + immutable → perfect dedup key.
--   - The webhook handler inserts ON CONFLICT DO NOTHING at the top of
--     processing; if RETURNING comes back empty, we've already processed
--     this event and can short-circuit with 200.
--
-- Retention: rows survive forever for audit, but the table is tiny
-- (~1-2 events per order). A 6-month cleanup cron could trim old rows
-- if it ever bloats; not added here.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.stripe_events_processed (
  event_id    text PRIMARY KEY,
  event_type  text NOT NULL,
  -- The handler outcome — 'success' means we ran the side effects;
  -- 'skipped' means we recognized the event but had nothing to do
  -- (e.g. it pre-dated our processing). Stored so a future audit
  -- can distinguish "I processed and committed" from "I saw and
  -- ignored".
  outcome     text NOT NULL DEFAULT 'success'
              CHECK (outcome IN ('success', 'skipped')),
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stripe_events_processed_at
  ON public.stripe_events_processed (processed_at);

ALTER TABLE public.stripe_events_processed ENABLE ROW LEVEL SECURITY;

-- Only the service role (and admins with manage:orders) ever needs
-- to see these. Customers / anon: never.
DROP POLICY IF EXISTS stripe_events_admin_select ON public.stripe_events_processed;
CREATE POLICY stripe_events_admin_select
  ON public.stripe_events_processed FOR SELECT
  TO authenticated
  USING (public.has_permission('manage:orders'));

-- No INSERT/UPDATE/DELETE policy → only service-role bypass writes.

NOTIFY pgrst, 'reload schema';
