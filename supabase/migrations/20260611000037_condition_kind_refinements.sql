-- =============================================================================
-- Offers engine v2.3 — Condition kind refinements.
--
--  1. Rename condition kind `stock_threshold` → `available_quantity`.
--     New config supports two modes:
--        - { mode: 'range', min: N, max: N | null, scope_kind, scope_id }
--          Rule applies WHILE stock ∈ [min, max] (max=null means "or above")
--        - { mode: 'until_oos', scope_kind, scope_id }
--          Rule applies WHILE stock > 0
--     Backfill: legacy { threshold, scope_kind, scope_id } maps to
--     { mode: 'range', min: 0, max: threshold, scope_kind, scope_id }.
--
--  2. Extend `user_type` config to support 'individual' mode targeting
--     a specific customer. The previous values 'authenticated'/'guest'
--     stay; new is 'individual' with config.customer_id.
--
--  3. Tighten the rule_conditions.kind CHECK constraint to include the
--     new kind name.
-- =============================================================================

-- ─── Step 1: rename stock_threshold → available_quantity (data + CHECK) ─

-- Rewrite existing config to the new shape FIRST (before changing the kind).
UPDATE public.rule_conditions
SET config = jsonb_build_object(
  'mode',       'range',
  'min',        0,
  'max',        (config->>'threshold')::int,
  'scope_kind', config->>'scope_kind',
  'scope_id',   config->>'scope_id'
)
WHERE kind = 'stock_threshold';

UPDATE public.rule_conditions
SET kind = 'available_quantity'
WHERE kind = 'stock_threshold';

-- ─── Step 2: tighten CHECK to include the new kind ──────────────────
ALTER TABLE public.rule_conditions
  DROP CONSTRAINT IF EXISTS rule_conditions_kind_check;
ALTER TABLE public.rule_conditions
  ADD CONSTRAINT rule_conditions_kind_check
  CHECK (kind IN (
    'timeframe',
    'user_type',
    'min_subtotal',
    'min_item_count',
    'available_quantity'
  ));

-- ─── Step 3: user_type 'individual' mode — no data migration needed ─
-- The config jsonb already accepts any object shape; the Zod schema at
-- the action layer enforces the new variant. Legacy rows with
-- { value: 'authenticated' } or { value: 'guest' } continue to work.

NOTIFY pgrst, 'reload schema';
