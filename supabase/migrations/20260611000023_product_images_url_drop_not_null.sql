-- =============================================================================
-- product_images.url: drop NOT NULL constraint.
--
-- Background:
--   Migration 20260611000020_product_images_storage_key.sql added the new
--   `storage_key` and `bucket` columns and a CHECK constraint requiring
--   that at least one of (url, storage_key) be non-null:
--
--     ADD CONSTRAINT product_images_url_or_key_check
--     CHECK (url IS NOT NULL OR storage_key IS NOT NULL);
--
--   The intent: new uploads use storage_key (resolved to a URL via the
--   StorageProvider abstraction); legacy rows keep their `url` value.
--
--   But that migration FORGOT to drop the original `url text NOT NULL`
--   constraint on the column. Result: new uploads via
--   recordProductImage() set `url: null` (correct for the new schema)
--   and Postgres rejects them with:
--
--     null value in column "url" of relation "product_images"
--     violates not-null constraint (SQLSTATE 23502)
--
--   This migration drops the column-level NOT NULL. The CHECK
--   constraint already enforces "at least one of url/storage_key
--   non-null" so we keep the same data-integrity guarantee.
--
-- Safety:
--   - Existing rows still have `url` populated (they were inserted
--     under the old NOT NULL rule); this migration is purely permissive
--   - The CHECK constraint catches any attempt to insert a row with
--     BOTH url AND storage_key null
--   - Backward compatible: legacy code that inserts a url value keeps
--     working unchanged
-- =============================================================================

ALTER TABLE public.product_images
  ALTER COLUMN url DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
