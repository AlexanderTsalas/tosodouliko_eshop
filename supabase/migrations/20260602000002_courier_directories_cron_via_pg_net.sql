-- =============================================================================
-- Phase 10 — optional pg_cron + pg_net schedule for the
-- /api/cron/courier-directories endpoint.
--
-- Refreshes the unified couriers_location_cache table once a week. ACS
-- station/smartpoint lists turn over slowly; the 30-day TTL on individual
-- rows is the hot-path correctness guarantee, and this cron is insurance
-- against the cache getting old enough that proximity sort drifts.
--
-- Follows the same shape as wishlist-advance: the DO/EXCEPTION wrapper
-- makes the migration safely no-op on projects without pg_cron / pg_net.
-- The endpoint is still callable manually or via an external scheduler
-- in that case.
--
-- Required GUCs (Database → Settings → Database in Supabase dashboard):
--   app.site_url        — e.g. https://yourdomain.com
--   app.cron_secret     — same string as CRON_SECRET in the Next.js env
--
-- Set per-database via:
--   ALTER DATABASE postgres SET app.site_url    = 'https://...';
--   ALTER DATABASE postgres SET app.cron_secret = '<hex string>';
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('courier-directories');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'courier-directories',
    -- Sunday at 03:00 UTC — off-peak for Greek business hours and well
    -- outside the typical checkout traffic window.
    '0 3 * * 0',
    $cmd$
      SELECT net.http_post(
        url     := current_setting('app.site_url', true) || '/api/cron/courier-directories',
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
    'pg_cron+pg_net scheduling failed: %. The /api/cron/courier-directories endpoint is still callable manually or via an external scheduler (Vercel Cron / cron-job.org / etc.).',
    SQLERRM;
END $$;
