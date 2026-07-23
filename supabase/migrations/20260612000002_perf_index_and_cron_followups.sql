-- =============================================================================
-- Follow-up perf pass after the wider DB audit (June 2026).
--
-- Two missing FK indexes + a cron re-cadence. Small, surgical — these are
-- the audit's confirmed gaps after spot-checking that several other
-- "missing" indexes flagged in the audit actually already exist
-- (idx_rcc_code on rule_code_customers, idx_priority_holds_active_expires).
-- =============================================================================

-- ─── 1. pending_wishlist_notifications.wishlist_item_id ──────────────────────
-- This FK has ON DELETE CASCADE referencing wishlist_items(id). Without an
-- index on the referencing column, deleting a wishlist_item forces a
-- sequential scan of pending_wishlist_notifications. Low-cardinality on
-- a small table today, but the queue grows with wishlist activity and the
-- cascade fires whenever a customer removes an item from their wishlist.
CREATE INDEX IF NOT EXISTS idx_pending_wishlist_notifications_wishlist_item
  ON public.pending_wishlist_notifications(wishlist_item_id);

-- ─── 2. (REMOVED on 2026-06-13) rule_customer_usage.rule_id ─────────────────
-- This step originally added `CREATE INDEX idx_rcu_rule ON
-- public.rule_customer_usage(rule_id)`. By the time this migration is
-- applied, the rule_customer_usage table no longer exists — it was
-- dropped + replaced by rule_code_customer_usage in
-- 20260611000036_usage_limits_to_codes.sql, which moved usage tracking
-- from per-rule to per-code. The new table's UNIQUE (rule_code_id,
-- customer_id) constraint already provides the btree index that FK
-- cascades and per-code-id lookups need, so this entry is now
-- redundant on top of being broken. Step intentionally left as a
-- comment so the history of the perf-audit decision stays readable.
--
-- ─── 3. Re-cadence wishlist-advance cron from 1m → 5m ────────────────────────
-- The endpoint is a heartbeat fallback — most invocations do nothing. The
-- inline trigger from `release_expired_priority_holds` does the real work;
-- the cron only catches cases where the SQL reaper freed inventory but
-- couldn't send emails. 1440 invocations/day (1m cadence) was paying for
-- coverage we don't need. 5m drops that to 288/day with at most a 5-minute
-- delay on the rare email-only edge case.
--
-- The DO/EXCEPTION wrapper mirrors the original migration's tolerance for
-- environments without pg_cron+pg_net enabled.
DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('wishlist-advance');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'wishlist-advance',
    '*/5 * * * *',
    $cmd$
      SELECT net.http_post(
        url     := current_setting('app.site_url', true) || '/api/cron/wishlist-advance',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.cron_secret', true),
          'Content-Type',  'application/json'
        ),
        body    := '{}'::jsonb
      );
    $cmd$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE
    'pg_cron+pg_net rescheduling failed: %. Schedule the endpoint manually if needed.',
    SQLERRM;
END $$;
