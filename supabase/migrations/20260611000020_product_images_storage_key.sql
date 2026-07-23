-- =============================================================================
-- product_images storage abstraction: add storage_key + bucket columns.
--
-- Background:
--   product_images.url currently stores the FULL URL of the asset's
--   public-read endpoint on Supabase Storage. That ties every row to
--   whatever provider was active at upload time. Migrating providers
--   later (e.g. Supabase → Cloudflare R2) would require rewriting every
--   url value in the table.
--
--   media_assets already uses the right shape: (bucket, storage_key).
--   This migration brings product_images in line + backfills the new
--   columns from existing URLs.
--
--   The transition is additive:
--
--     1. Add nullable `storage_key` + `bucket` columns
--     2. Backfill from URL parsing (Supabase pattern only — non-matching
--        URLs are left untouched)
--     3. Add a CHECK constraint requiring at least one of (url,
--        storage_key) to be non-null — guarantees readers always have a
--        way to derive the URL
--     4. (Future) After application code is fully migrated to read
--        storage_key, drop the url column in a separate migration
--
--   During the transition the application layer reads BOTH columns:
--
--     resolveImageUrl(image):
--       if image.storage_key: return provider.publicUrl(...)
--       else: return image.url
--
--   See src/lib/storage/index.ts for the helper.
--
-- =============================================================================

-- ──── 1. Schema: add columns ────────────────────────────────────────────────
ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS storage_key text,
  ADD COLUMN IF NOT EXISTS bucket      text;

COMMENT ON COLUMN public.product_images.storage_key IS
'Provider-agnostic object key, e.g. ''abc-uuid/hero.jpg''. The application resolves the public URL at query time via the active StorageProvider. Replaces the URL column for any new uploads. See src/lib/storage/.';

COMMENT ON COLUMN public.product_images.bucket IS
'Logical bucket name for the provider, e.g. ''product-images''. NULL means the application default (DEFAULT_PRODUCT_IMAGES_BUCKET in src/lib/storage/index.ts).';

-- ──── 2. Backfill from existing Supabase URLs ───────────────────────────────
-- Supabase Storage public URL shape:
--   https://<project>.supabase.co/storage/v1/object/public/<bucket>/<key>
--
-- Extract bucket + key via regexp. URLs not matching this pattern (e.g.
-- externally-hosted images, marketplace-uploaded assets) keep
-- storage_key/bucket NULL and the application falls back to the URL via
-- resolveImageUrl().
UPDATE public.product_images
SET
  bucket = COALESCE(
    bucket,
    NULLIF(
      regexp_replace(
        url,
        '^https?://[^/]+/storage/v1/object/(?:public|sign)/([^/?]+)/.*$',
        '\1'
      ),
      url
    )
  ),
  storage_key = COALESCE(
    storage_key,
    NULLIF(
      regexp_replace(
        url,
        '^https?://[^/]+/storage/v1/object/(?:public|sign)/[^/?]+/([^?]+).*$',
        '\1'
      ),
      url
    )
  )
WHERE storage_key IS NULL
  AND url ~ '^https?://[^/]+/storage/v1/object/(?:public|sign)/[^/?]+/';

-- ──── 3. Integrity constraint ───────────────────────────────────────────────
-- At least one of (url, storage_key) must be non-null — readers always
-- have a way to derive the public URL during the transition window.
ALTER TABLE public.product_images
  DROP CONSTRAINT IF EXISTS product_images_url_or_key_check;
ALTER TABLE public.product_images
  ADD CONSTRAINT product_images_url_or_key_check
  CHECK (url IS NOT NULL OR storage_key IS NOT NULL);

-- ──── 4. Index on bucket for admin filtering ────────────────────────────────
-- Lets future admin UIs filter by bucket without a full scan. Partial
-- because the vast majority of legacy rows have bucket=NULL during the
-- transition window.
CREATE INDEX IF NOT EXISTS idx_product_images_bucket
  ON public.product_images(bucket)
  WHERE bucket IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Rollback (uncomment to apply):
-- =============================================================================
-- DROP INDEX IF EXISTS public.idx_product_images_bucket;
-- ALTER TABLE public.product_images
--   DROP CONSTRAINT IF EXISTS product_images_url_or_key_check;
-- ALTER TABLE public.product_images
--   DROP COLUMN IF EXISTS storage_key,
--   DROP COLUMN IF EXISTS bucket;
