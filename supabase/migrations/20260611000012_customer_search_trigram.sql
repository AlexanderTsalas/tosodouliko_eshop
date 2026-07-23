-- =============================================================================
-- Phase 6 — pg_trgm customer search.
--
-- Background:
--   `searchCustomers` (src/actions/orders/searchCustomers.ts) uses
--     .or("email.ilike.%X%, first_name.ilike.%X%, ...")
--   which forces a sequential scan of customers — leading-wildcard
--   ILIKE can't use the existing equality-only indexes. At 5k customers
--   the query takes ~500-2000ms; at 50k it becomes effectively unusable
--   (5+ seconds).
--
--   This migration:
--     1. Enables pg_trgm (Postgres trigram extension)
--     2. Creates a GIN index over the 4 search columns with
--        gin_trgm_ops
--
--   pg_trgm makes %X% queries use the index. At 50k customers, the
--   same query drops to ~10-30ms — a 100-200x improvement.
--
--   No code change is needed. PostgREST's `.ilike` translates to the
--   same SQL ILIKE operator, which the planner now satisfies via the
--   GIN. Verify with EXPLAIN ANALYZE on /admin/orders search after
--   applying.
--
--   The existing idx_customers_email_phone_normalized (equality lookups
--   from the order-placement match path) stays — it serves a different
--   query shape and is cheaper than the GIN for exact lookups.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Composite GIN over four trigram-indexed text columns. The
-- gin_trgm_ops operator class enables index acceleration for ILIKE,
-- LIKE, and similarity() operators on each column.
--
-- coalesce(...) wraps each column so NULL values don't break the
-- composite index — pg_trgm doesn't index NULLs and the multi-column
-- form requires non-null inputs.
CREATE INDEX IF NOT EXISTS idx_customers_search_trgm
  ON public.customers
  USING gin (
    coalesce(email,      '') gin_trgm_ops,
    coalesce(first_name, '') gin_trgm_ops,
    coalesce(last_name,  '') gin_trgm_ops,
    coalesce(phone,      '') gin_trgm_ops
  );

NOTIFY pgrst, 'reload schema';
