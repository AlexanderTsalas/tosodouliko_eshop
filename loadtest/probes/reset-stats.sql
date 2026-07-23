-- ──────────────────────────────────────────────────────────────────────────
-- Run this IMMEDIATELY BEFORE starting a k6 run.
--
-- pg_stat_statements accumulates timing data since the DB started. Without
-- resetting first, every "slowest queries" view shows the mixed history of
-- this run + every prior run + the seed script + admin actions, etc.
--
-- Resetting gives you a clean baseline so the after/ probes attribute time
-- to THIS test only.
-- ──────────────────────────────────────────────────────────────────────────

SELECT pg_stat_statements_reset();

-- Optionally also reset pg_stat_user_tables / indexes to capture
-- only-this-run table activity and index usage:
-- SELECT pg_stat_reset();
