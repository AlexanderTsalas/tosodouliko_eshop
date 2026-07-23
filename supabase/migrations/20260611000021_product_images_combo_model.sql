-- =============================================================================
-- Product images: subset-match association model.
--
-- Phase 1 of docs/product-images-architecture.md. Adds the columns the
-- new image system needs and backfills them from existing data so
-- nothing breaks while subsequent phases land.
--
-- What this migration does:
--
--   1. `products.image_axes text[]` — declares which attribute axes
--      drive image selection for each product. E.g. ['color'] means
--      changing the color picker swaps images; changing size does not.
--      Defaults to '{}' (no image-driving axes); legacy products keep
--      showing all images regardless of variant selection until an
--      admin sets this.
--
--   2. `product_images.attribute_combo jsonb` — subset of axis values
--      this image applies to. Empty/NULL = general image (always
--      shown). Storefront subset-matches this against the customer's
--      currently-selected variant's attribute_combo restricted to
--      products.image_axes.
--
--   3. `product_images.media_asset_id` — FK to media_assets. Multiple
--      product_images rows can point at one media_asset (image reuse
--      across products and attribute-combo groups).
--
--   4. `product_images.is_cover boolean` — marks the cover for its
--      attribute_combo group. Replaces the legacy `is_primary` semantic
--      with one that's per-combo. Server actions enforce single-cover-
--      per-combo atomically.
--
--   5. `product_images.alt_text_is_auto boolean` — true when alt_text
--      was auto-generated from product name + combo value labels. When
--      product name or combo values change later, auto-generated alts
--      get refreshed; admin-overridden ones are preserved.
--
-- Backfill strategy (idempotent):
--
--   a. attribute_combo derived from existing variant_id: an image tied
--      to a specific variant inherits that variant's attribute_combo
--   b. media_asset_id matched by (bucket, storage_key) tuple if
--      product_images has them populated from migration 20260611000020
--      and a media_assets row exists with the same coordinates
--   c. is_cover copied from is_primary
--
-- Legacy columns (url, variant_id, is_primary) stay in place — Phase 8
-- of the rollout will drop them after every caller has been migrated
-- to the new model.
-- =============================================================================

-- ──── 1. products.image_axes ────────────────────────────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_axes text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.products.image_axes IS
'Attribute slugs that drive image selection on this product. e.g. [''color''] means the picker color-change swaps images; size-change does not. Storefront filters product_images by matching attribute_combo subset against the customer''s currently-selected variant''s attribute_combo restricted to these axes.';

-- ──── 2. product_images.attribute_combo + GIN index ─────────────────────────
ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS attribute_combo jsonb;

COMMENT ON COLUMN public.product_images.attribute_combo IS
'Subset of attribute-axis values that determine when this image shows. {} or NULL = general image (always applies). {color: red-uuid} = applies to any variant whose attribute_combo includes color=red, regardless of other axes. {color: red-uuid, size: L-uuid} = applies only to that combination. Storefront subset-matches against the customer''s currently-selected variant''s attribute_combo restricted to products.image_axes.';

-- GIN supports the @> containment operator used by the storefront
-- selection query. The partial-index predicate excludes general images
-- (combo IS NULL) from the index since they''re trivially queried.
CREATE INDEX IF NOT EXISTS idx_product_images_combo_gin
  ON public.product_images
  USING gin (attribute_combo)
  WHERE attribute_combo IS NOT NULL;

-- ──── 3. product_images.media_asset_id ──────────────────────────────────────
ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS media_asset_id uuid
    REFERENCES public.media_assets(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.product_images.media_asset_id IS
'FK to media_assets — the actual file. Multiple product_images rows can reference the same media_asset (image reuse). NULL only for legacy rows where storage_key was populated directly without going through the media library.';

CREATE INDEX IF NOT EXISTS idx_product_images_media_asset
  ON public.product_images(media_asset_id)
  WHERE media_asset_id IS NOT NULL;

-- ──── 4. product_images.is_cover ────────────────────────────────────────────
ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS is_cover boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.product_images.is_cover IS
'Marks this image as the cover for its (product, attribute_combo) group. Enforced single-cover-per-group via server-action transactions, NOT a SQL constraint, because attribute_combo is jsonb and the resulting unique-index would be expensive on write.';

-- ──── 5. product_images.alt_text_is_auto ────────────────────────────────────
ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS alt_text_is_auto boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.product_images.alt_text_is_auto IS
'TRUE = alt_text was auto-generated from product.name + attribute_combo value labels at upload. Will be regenerated if the underlying product/labels change. FALSE = admin manually edited the alt text — preserved verbatim.';

-- ──── 6. Backfill attribute_combo from existing variant_id rows ─────────────
-- An image previously tied to a specific variant gets that variant''s
-- full attribute_combo. The new subset-match algorithm then produces
-- identical results to the old direct-FK match for these rows.
UPDATE public.product_images pi
SET attribute_combo = v.attribute_combo
FROM public.product_variants v
WHERE pi.variant_id = v.id
  AND pi.attribute_combo IS NULL
  AND v.attribute_combo IS NOT NULL;

-- ──── 7. Backfill media_asset_id from storage_key matches ───────────────────
-- Migration 20260611000020 added storage_key + bucket to product_images
-- (parsed from legacy URLs). Where these match a media_assets row, link
-- them. Rows whose URL didn''t parse cleanly stay with media_asset_id =
-- NULL (the app falls back to storage_key or url directly).
UPDATE public.product_images pi
SET media_asset_id = ma.id
FROM public.media_assets ma
WHERE pi.media_asset_id IS NULL
  AND pi.storage_key IS NOT NULL
  AND pi.bucket IS NOT NULL
  AND ma.bucket = pi.bucket
  AND ma.storage_key = pi.storage_key;

-- ──── 8. Backfill is_cover from legacy is_primary ───────────────────────────
-- The legacy is_primary column marked "the main image of this product."
-- That maps to "cover of the attribute_combo this image was on" in the
-- new model. Per-product there was at most one is_primary; per-combo
-- there''ll now be at most one is_cover (enforced by the server actions).
UPDATE public.product_images
SET is_cover = true
WHERE is_primary = true
  AND is_cover = false;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Rollback:
-- =============================================================================
-- DROP INDEX IF EXISTS public.idx_product_images_combo_gin;
-- DROP INDEX IF EXISTS public.idx_product_images_media_asset;
-- ALTER TABLE public.product_images
--   DROP COLUMN IF EXISTS attribute_combo,
--   DROP COLUMN IF EXISTS media_asset_id,
--   DROP COLUMN IF EXISTS is_cover,
--   DROP COLUMN IF EXISTS alt_text_is_auto;
-- ALTER TABLE public.products
--   DROP COLUMN IF EXISTS image_axes;
