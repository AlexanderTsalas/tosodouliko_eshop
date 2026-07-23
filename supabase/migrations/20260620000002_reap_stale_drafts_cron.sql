-- =============================================================================
-- pg_cron + pg_net schedule for /api/cron/reap-stale-drafts.
--
-- Deletes abandoned draft products (products.is_draft = true) untouched for
-- ≥ 48h. Keyed on is_draft, so intentionally-inactive finished products are
-- never affected. Cascades clean up variant/image rows; the media reaper
-- (04:15 UTC) sweeps the orphaned storage blobs afterwards.
--
-- Schedule: nightly at 04:45 UTC — staggered after reap-orphan-media (04:15)
-- so the draft deletes land first and the media reaper picks up their now-
-- orphaned blobs on the same night... but since they're 30m apart, blobs
-- orphaned tonight are swept tomorrow night (acceptable — they're already
-- behind the 24h media window).
--
-- Required GUCs (same as the media reaper):
--   app.site_url     — e.g. https://yourdomain.com
--   app.cron_secret  — same string as CRON_SECRET in the Next.js env
--
-- DO/EXCEPTION wrapper → safe no-op where pg_cron/pg_net is unavailable;
-- the endpoint stays callable manually or via an external scheduler.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('reap-stale-drafts');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'reap-stale-drafts',
    '45 4 * * *',
    $cmd$
      SELECT net.http_post(
        url     := current_setting('app.site_url', true) || '/api/cron/reap-stale-drafts',
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
    'pg_cron+pg_net scheduling failed: %. The /api/cron/reap-stale-drafts endpoint is still callable manually or via an external scheduler (cron-job.org, GitHub Actions, etc.).',
    SQLERRM;
END $$;
