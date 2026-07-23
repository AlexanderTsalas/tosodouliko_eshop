-- ──────────────────────────────────────────────────────────────────────────
-- POST-MORTEM PROBE — which indexes carried the load?
--
-- For each user-facing table, lists indexes by scan count.
--
-- Read the result:
--   * Top rows = indexes that earned their disk space; the planner kept
--     picking them.
--   * Rows with `times_used = 0` + significant `size` = waste. Someone
--     created an index that the workload doesn't hit. Candidate for
--     dropping (only after confirming it's not needed for OTHER workloads).
--   * A table with NO index in the top 20 = its queries are doing full
--     scans. Check seq_scan counts in table-activity.sql.
-- ──────────────────────────────────────────────────────────────────────────

SELECT
  s.relname                                          AS table_name,
  s.indexrelname                                     AS index_name,
  s.idx_scan                                         AS times_used,
  s.idx_tup_read                                     AS rows_returned,
  pg_size_pretty(pg_relation_size(s.indexrelid))     AS index_size
FROM pg_stat_user_indexes s
WHERE s.schemaname = 'public'
ORDER BY s.idx_scan DESC, pg_relation_size(s.indexrelid) DESC
LIMIT 30;
