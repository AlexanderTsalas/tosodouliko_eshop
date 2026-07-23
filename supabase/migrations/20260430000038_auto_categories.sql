-- =============================================================================
-- Auto-categories (rule-based membership).
--
-- A category can be in one of two modes:
--   - 'manual' (default): membership is the rows in product_categories
--   - 'auto':             membership is computed from `auto_rules` — a jsonb
--                         document defining attribute filters; matching
--                         variants (and their parent products) are members
--
-- Example auto_rules shape:
--   { "attribute_filters": { "size": ["10ml", "30ml"], "nicotine": ["0mg"] } }
--
-- Semantics: OR within an attribute, AND across attributes.
--   size in (10ml OR 30ml) AND nicotine = 0mg
--
-- All actual filtering uses the GIN index on product_variants.attribute_combo
-- added in migration 37 — so auto-categories are fast even at scale.
-- =============================================================================

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'manual'
  CHECK (mode IN ('manual', 'auto'));

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS auto_rules jsonb;

COMMENT ON COLUMN public.categories.mode IS
  '''manual'' uses product_categories junction rows. ''auto'' computes membership from auto_rules.';

COMMENT ON COLUMN public.categories.auto_rules IS
  'Rule document for mode=''auto''. Shape: {"attribute_filters": {"<attribute_slug>": ["value", ...]}}. OR within a key, AND across keys.';
