-- =============================================================================
-- Per-product splits_listing overrides.
--
-- `attributes.splits_listing` is the global default. This column stores a
-- sparse override map keyed by attribute slug:
--
--   { "flavour": true }     ← force-split this product on flavour
--   { "size": false }       ← suppress global size splitter for this product
--   { "flavour": true, "size": false }  ← combine
--
-- Effective splitter set for a product:
--   (global splitters ∪ keys where override = true) \ keys where override = false
--
-- Absent or NULL → fall back entirely to the global flag.
-- =============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS split_overrides jsonb;

COMMENT ON COLUMN public.products.split_overrides IS
  'Sparse per-attribute override of attributes.splits_listing. Shape: {"<attribute_slug>": boolean}. Present TRUE forces the splitter on for this product; present FALSE suppresses it; absent keys defer to the global attributes.splits_listing flag.';
