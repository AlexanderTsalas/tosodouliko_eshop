-- =============================================================================
-- Split-listing + variant-attribute GIN index.
--
-- Each attribute can opt in to "split" the catalog listing: every distinct
-- value among its variants becomes its own card on /products and gets a
-- unique slug-appended URL (e.g., /products/vape-x-strawberry).
--
-- The GIN index on product_variants.attribute_combo accelerates the
-- variant-grained queries that split-listing, facets, and auto-categories
-- (next phase) all share.
-- =============================================================================

ALTER TABLE public.attributes
  ADD COLUMN IF NOT EXISTS splits_listing boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.attributes.splits_listing IS
  'When TRUE, distinct values of this attribute among a product''s variants split that product into separate catalog cards (one per value).';

-- GIN supports `@> '{"flavour": "strawberry"}'::jsonb` containment queries in
-- O(log n) — critical for variant-grained filtering at scale.
CREATE INDEX IF NOT EXISTS idx_product_variants_attribute_combo
  ON public.product_variants USING GIN (attribute_combo);
