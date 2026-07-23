-- =============================================================================
-- Optional variant assignment for product images.
--
-- A product_image with variant_id = NULL is a "general" image shown for any
-- variant that has no specific image of its own. With variant_id set, the
-- image is preferred when that variant is selected on the storefront.
-- =============================================================================

ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS variant_id uuid
  REFERENCES public.product_variants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_product_images_variant_id
  ON public.product_images(variant_id) WHERE variant_id IS NOT NULL;

COMMENT ON COLUMN public.product_images.variant_id
IS 'Optional variant scoping. NULL = general image (shown for any variant). Set = variant-specific (preferred when that variant is selected).';
