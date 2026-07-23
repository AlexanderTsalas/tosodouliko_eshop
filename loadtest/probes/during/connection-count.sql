-- ──────────────────────────────────────────────────────────────────────────
-- LIVE PROBE — how many DB connections is the app pool holding?
--
-- Local Supabase Postgres defaults to ~100 max connections. If `total`
-- climbs into the 80-100 range, you've found a hard ceiling — incoming
-- requests are blocked waiting for a free connection.
--
-- A healthy pool: `active` matches the rough number of in-flight requests,
-- `idle` matches the pool's "warm" reserve.
-- ──────────────────────────────────────────────────────────────────────────

SELECT
  count(*)                                         AS total,
  count(*) FILTER (WHERE state = 'active')         AS active,
  count(*) FILTER (WHERE state = 'idle')           AS idle,
  count(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_tx
FROM pg_stat_activity
WHERE backend_type = 'client backend';
