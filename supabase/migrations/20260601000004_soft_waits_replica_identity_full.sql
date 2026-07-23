-- =============================================================================
-- Set REPLICA IDENTITY FULL on soft_waits so DELETE events emitted over
-- Supabase Realtime carry the full OLD row (not just the primary key).
--
-- NOTE: CollapseWatcher no longer relies on soft_waits DELETE events — it
-- subscribes to INSERT events on collapse_notifications instead (see
-- 20260601000005_collapse_notifications.sql). REPLICA IDENTITY FULL is
-- left in place because soft_waits is small and ephemeral, the WAL
-- overhead is negligible, and other future consumers may benefit from
-- richer DELETE payloads. No harm; not load-bearing.
-- =============================================================================

ALTER TABLE public.soft_waits REPLICA IDENTITY FULL;
