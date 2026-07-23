-- ──────────────────────────────────────────────────────────────────────────
-- POST-MORTEM PROBE — which tables got hammered, and how?
--
-- Useful for two purposes:
--
-- 1. SANITY CHECK: verify the scenario did what you expected. If you ran
--    "browse only" but `cart_items` has high write activity, something's
--    off.
--
-- 2. SCAN PATTERN INSIGHT: `seq_scan` > 0 on a sizeable table is a warning.
--    A full table scan is fast on the 5-row thin seed but catastrophic on
--    production scale. Cross-reference with index-usage.sql to see if
--    appropriate indexes exist but the planner is ignoring them.
-- ──────────────────────────────────────────────────────────────────────────

SELECT
  relname                  AS table,
  seq_scan                 AS full_scans,
  idx_scan                 AS index_scans,
  n_tup_ins                AS inserts,
  n_tup_upd                AS updates,
  n_tup_del                AS deletes,
  n_live_tup               AS row_count
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND (seq_scan + idx_scan + n_tup_ins + n_tup_upd + n_tup_del) > 0
ORDER BY (seq_scan + idx_scan) DESC
LIMIT 30;
