-- =============================================================================
-- Phase 6 follow-up — optional pg_cron + pg_net schedule for the
-- /api/cron/wishlist-advance endpoint.
--
-- The TS tickle endpoint advances the wishlist queue when no inline
-- trigger has woken the dispatcher (notably: when a wishlist_notification
-- priority hold expires unconsumed; SQL-side `release_expired_priority_holds`
-- frees the inventory but can't send emails, so the TS sweep finishes the
-- job).
--
-- This migration schedules the endpoint to be called every minute. It uses
-- pg_net to make the HTTP call; both pg_cron and pg_net must be enabled
-- for the schedule to succeed. The DO/EXCEPTION wrapper makes the migration
-- safely no-op on projects without either extension — you can call the
-- endpoint manually or schedule it via Vercel Cron / cron-job.org / etc.
--
-- Required GUCs (Database → Settings → Database in Supabase dashboard):
--   app.site_url        — e.g. https://yourdomain.com
--   app.cron_secret     — same string as CRON_SECRET in the Next.js env
--
-- They can be set per-database via:
--   ALTER DATABASE postgres SET app.site_url   = 'https://...';
--   ALTER DATABASE postgres SET app.cron_secret = '<hex string>';
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('wishlist-advance');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'wishlist-advance',
    '* * * * *',
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
    'pg_cron+pg_net scheduling failed: %. The /api/cron/wishlist-advance endpoint is still callable manually or via an external scheduler (Vercel Cron / cron-job.org / etc.).',
    SQLERRM;
END $$;
