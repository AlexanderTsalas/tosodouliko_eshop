-- =============================================================================
-- Drop legacy product_images columns no longer referenced by application code.
--
-- Background:
--   Phase 8 of the product-images architecture plan (per docs/) — clean
--   up the schema once all legacy code paths are deleted. The legacy
--   code (VariantImagesTab, ProductImagesEditor, addProductImage,
--   setPrimaryImage, setImageVariant, deleteProductImage,
--   reorderProductImages) was removed in the same release as this
--   migration. With nothing left to read or write these columns, they
--   can be dropped.
--
-- Dropped:
--   - product_images.variant_id  — added in migration 35; superseded
--     by attribute_combo (a jsonb subset of axis→value bindings).
--     attribute_combo expresses image-scoping much more flexibly:
--     general / per-color / per-color+size / etc.
--   - product_images.is_primary  — original "cover" flag, scoped to
--     the whole product. Superseded by is_cover which scopes to
--     the (product, attribute_combo) group. The selectImagesForVariant
--     storefront algorithm and the new admin UI use is_cover.
--
-- Safety:
--   - No application code reads or writes these columns after the
--     legacy code cleanup (verified by grep against src/).
--   - Indexes on these columns (idx_product_images_variant_id) get
--     auto-dropped with the column.
--   - This migration is the LAST step of the cleanup; it should not
--     ship before the application code that referenced the columns
--     has been removed in the same release.
-- =============================================================================

ALTER TABLE public.product_images
  DROP COLUMN IF EXISTS variant_id;

ALTER TABLE public.product_images
  DROP COLUMN IF EXISTS is_primary;

NOTIFY pgrst, 'reload schema';
