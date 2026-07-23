-- =============================================================================
-- wishlist_items — add updated_at column.
--
-- The original wishlist_items schema (20260430000017) only had created_at.
-- Later migrations added per-item notification flags (notify_on_restock,
-- notify_on_sale, etc.) that ARE edited after creation — but no updated_at
-- column was ever added, even though `updateWishlistFlags` server action
-- has been writing to it unconditionally. The result: every flag toggle
-- failed with PostgREST schema-cache error
--   "Could not find the 'updated_at' column of 'wishlist_items'"
-- because the column genuinely didn't exist.
--
-- Fix: add the column. Existing rows get now() as a sensible default;
-- subsequent UPDATEs are responsible for refreshing the value (this
-- codebase's convention — actions set `updated_at: new Date().toISOString()`
-- in their .update() call rather than relying on a DB-side trigger; see
-- saveOrderTracking, updateProduct, etc.).
-- =============================================================================

ALTER TABLE public.wishlist_items
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Force PostgREST to reload its schema cache so the column is
-- immediately visible to the API layer (otherwise the next request
-- might still hit the stale cache for ~10 seconds).
NOTIFY pgrst, 'reload schema';
