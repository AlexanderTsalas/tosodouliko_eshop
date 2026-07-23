-- ──────────────────────────────────────────────────────────────────────────
-- POST-MORTEM PROBE — the most valuable single query for load test analysis.
--
-- Shows queries ranked by TOTAL time spent (across all calls). This is your
-- optimization target list: the top row is where most of the test's DB time
-- went; that's the query to focus on first.
--
-- Read the result:
--   * High `calls` + low `avg_ms`  → query runs a lot, individually cheap.
--                                     Optimization: reduce call count (caching,
--                                     batching) more than per-query time.
--   * Low `calls` + high `avg_ms`  → rare but expensive. Optimization: speed
--                                     it up (better index, query rewrite).
--   * High `max_ms` vs low `avg_ms`→ tail-latency problem. Investigate the
--                                     slow ones — locks, cold cache, planner
--                                     plan switches?
--
-- Run pg_stat_statements_reset() FIRST (see ../reset-stats.sql) for
-- accurate per-run attribution.
-- ──────────────────────────────────────────────────────────────────────────

SELECT
  calls,
  round(total_exec_time::numeric, 1)                 AS total_ms,
  round(mean_exec_time::numeric, 2)                  AS avg_ms,
  round(max_exec_time::numeric, 2)                   AS max_ms,
  round((100.0 * total_exec_time / sum(total_exec_time) OVER ())::numeric, 1) AS pct_of_total,
  substring(query, 1, 200)                           AS query
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat_%'           -- exclude this probe's own queries
  AND query NOT LIKE 'COMMIT%'
  AND query NOT LIKE 'BEGIN%'
ORDER BY total_exec_time DESC
LIMIT 15;
