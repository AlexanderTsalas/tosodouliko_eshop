-- =============================================================================
-- Phase 7 follow-up — pg_cron + pg_net schedule for the
-- /api/cron/reap-orphan-media endpoint.
--
-- The TS reaper cleans up storage objects (in the product-images bucket
-- and any sibling buckets the storage abstraction manages) that aren't
-- referenced by any product_images.storage_key or
-- media_assets.storage_key AND have been around for ≥ 24 hours. The
-- 24-hour window protects against the race where a browser-direct
-- upload completed but recordProductImage() hasn't fired yet (admin tab
-- closed mid-upload, transient network failure, etc.).
--
-- Schedule: nightly at 04:15 UTC — off-peak for Greek business hours
-- and well outside the typical checkout traffic window. Stacked
-- slightly after `wishlist-advance` (which runs every minute, * * * * *)
-- to avoid coincident HTTP storm on the Next.js function pool.
--
-- The reaper has internal budgets:
--   - Pages up to 10,000 keys per run
--   - Deletes up to 500 objects per run
--   - Subsequent nightly ticks pick up the next chunk
-- These caps keep one run bounded; large backlogs drain over multiple
-- nights without overwhelming storage or function quotas.
--
-- Required GUCs (Database → Settings → Database in Supabase dashboard):
--   app.site_url        — e.g. https://yourdomain.com
--   app.cron_secret     — same string as CRON_SECRET in the Next.js env
--
-- Set per-database via:
--   ALTER DATABASE postgres SET app.site_url    = 'https://...';
--   ALTER DATABASE postgres SET app.cron_secret = '<hex string>';
--
-- The DO/EXCEPTION wrapper makes the migration safely no-op on projects
-- without pg_cron / pg_net. The endpoint is still callable manually or
-- via an external scheduler (cron-job.org, GitHub Actions) in that case.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('reap-orphan-media');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'reap-orphan-media',
    -- Nightly at 04:15 UTC (06:15 Athens). Off-peak; staggered after
    -- wishlist-advance's every-minute ticks to avoid contention.
    '15 4 * * *',
    $cmd$
      SELECT net.http_post(
        url     := current_setting('app.site_url', true) || '/api/cron/reap-orphan-media',
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
    'pg_cron+pg_net scheduling failed: %. The /api/cron/reap-orphan-media endpoint is still callable manually or via an external scheduler (cron-job.org, GitHub Actions, etc.).',
    SQLERRM;
END $$;
