-- ──────────────────────────────────────────────────────────────────────────
-- LIVE PROBE — what Postgres is actively doing RIGHT NOW.
--
-- Run repeatedly during a load test (every 10-30 sec) to watch how the
-- query workload evolves as load ramps up.
--
-- Read the result:
--   * Empty result            → DB has nothing to do. Server-side bottleneck
--                                (Node CPU, network, etc.) — NOT the DB.
--   * Few rows, short duration → DB is working but keeping up.
--   * Many rows, growing duration → queue backlog; requests are piling up.
--   * wait_event_type='Lock'   → contention. Something is blocked on a row
--                                or table lock. Inspect blocking_pid.
--   * wait_event='ClientWrite' → backend done, waiting for PostgREST to read
--                                its response — usually means the client is
--                                slow, not Postgres.
--   * wait_event='DataFileRead' → cold cache. First-time disk reads.
-- ──────────────────────────────────────────────────────────────────────────

SELECT
  pid,
  state,
  wait_event_type,
  wait_event,
  now() - query_start                                  AS duration,
  pg_blocking_pids(pid)                                AS blocked_by,
  substring(query, 1, 120)                             AS query
FROM pg_stat_activity
WHERE state IS DISTINCT FROM 'idle'
  AND pid <> pg_backend_pid()
  AND backend_type = 'client backend'
ORDER BY duration DESC;
