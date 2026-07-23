-- =============================================================================
-- Offers engine v2.1 — Path A: conditions as first-class entities.
--
-- Extracts the inline condition columns from `rules` into a new
-- `rule_conditions` table with type-driven jsonb config. Future
-- condition types ship as a TS dispatch entry + UI form — no schema
-- migration required.
--
-- Columns NOT extracted (these aren't "when" conditions):
--   - requires_code            — part of the action shape
--   - stacking_mode, priority  — how the action behaves after eligibility
--   - enforce_limits           — soft-vs-hard policy on the limits
--   - current_uses             — denorm counter
--
-- Columns extracted:
--   - starts_at, ends_at                       → 'timeframe' condition
--   - user_type                                → 'user_type' condition
--   - min_subtotal                             → 'min_subtotal' condition
--   - min_item_count                           → 'min_item_count' condition
--   - max_uses_total                           → 'usage_limit_total' condition
--   - max_uses_per_customer                    → 'usage_limit_per_customer' condition
--   - stock_threshold, stock_scope_kind/id     → 'stock_threshold' condition
--
-- The eligible_rules SQL function (migration 32) will be replaced in
-- migration 35 with a much simpler version — no inline column checks
-- since conditions live in their own table and are evaluated in TS.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: create rule_conditions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rule_conditions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id     uuid NOT NULL REFERENCES public.rules(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  -- Per-kind shape; validated at the server-action layer via Zod.
  -- Examples:
  --   timeframe                  → { "starts_at": "...", "ends_at": "..." }
  --   user_type                  → { "value": "authenticated" }
  --   min_subtotal               → { "threshold": 50 }
  --   min_item_count             → { "threshold": 3 }
  --   usage_limit_total          → { "max": 500 }
  --   usage_limit_per_customer   → { "max": 1 }
  --   stock_threshold            → { "threshold": 5, "scope_kind": "variant", "scope_id": "..." }
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CHECK (kind IN (
    'timeframe',
    'user_type',
    'min_subtotal',
    'min_item_count',
    'usage_limit_total',
    'usage_limit_per_customer',
    'stock_threshold'
  )),
  CHECK (jsonb_typeof(config) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_rule_conditions_rule
  ON public.rule_conditions(rule_id);
CREATE INDEX IF NOT EXISTS idx_rule_conditions_kind
  ON public.rule_conditions(kind);

ALTER TABLE public.rule_conditions ENABLE ROW LEVEL SECURITY;

-- Admin write
CREATE POLICY "rule_conditions_admin_write"
  ON public.rule_conditions FOR ALL TO authenticated
  USING (public.has_permission('manage:discounts'))
  WITH CHECK (public.has_permission('manage:discounts'));

-- Storefront read mirrors rules visibility (engine evaluates conditions
-- via admin client anyway; this RLS only matters if a customer direct-
-- queries the table).
CREATE POLICY "rule_conditions_select_storefront_safe"
  ON public.rule_conditions FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.rules r
    WHERE r.id = rule_id
      AND r.active = true
      AND r.requires_code = false
  ));

CREATE POLICY "rule_conditions_select_admin_all"
  ON public.rule_conditions FOR SELECT TO authenticated
  USING (public.has_permission('manage:discounts'));

COMMENT ON TABLE public.rule_conditions IS
'First-class condition entity per Path A redesign. Each rule has zero or more rule_conditions; engine AND-combines them. Each condition has a `kind` discriminator + a jsonb `config` validated per-kind in TS. New condition types ship as a TS dispatch entry + UI form, no schema migration needed.';

-- ---------------------------------------------------------------------------
-- Step 2: backfill from the existing inline columns
-- ---------------------------------------------------------------------------

-- timeframe: when either bound was set, insert one condition row.
INSERT INTO public.rule_conditions (rule_id, kind, config)
SELECT
  id,
  'timeframe',
  jsonb_strip_nulls(jsonb_build_object(
    'starts_at', starts_at,
    'ends_at', ends_at
  ))
FROM public.rules
WHERE starts_at IS NOT NULL OR ends_at IS NOT NULL;

-- user_type: only when it diverges from the default 'any'.
INSERT INTO public.rule_conditions (rule_id, kind, config)
SELECT id, 'user_type', jsonb_build_object('value', user_type)
FROM public.rules
WHERE user_type IS NOT NULL AND user_type != 'any';

-- min_subtotal
INSERT INTO public.rule_conditions (rule_id, kind, config)
SELECT id, 'min_subtotal', jsonb_build_object('threshold', min_subtotal)
FROM public.rules
WHERE min_subtotal IS NOT NULL;

-- min_item_count
INSERT INTO public.rule_conditions (rule_id, kind, config)
SELECT id, 'min_item_count', jsonb_build_object('threshold', min_item_count)
FROM public.rules
WHERE min_item_count IS NOT NULL;

-- usage_limit_total
INSERT INTO public.rule_conditions (rule_id, kind, config)
SELECT id, 'usage_limit_total', jsonb_build_object('max', max_uses_total)
FROM public.rules
WHERE max_uses_total IS NOT NULL;

-- usage_limit_per_customer
INSERT INTO public.rule_conditions (rule_id, kind, config)
SELECT id, 'usage_limit_per_customer', jsonb_build_object('max', max_uses_per_customer)
FROM public.rules
WHERE max_uses_per_customer IS NOT NULL;

-- stock_threshold
INSERT INTO public.rule_conditions (rule_id, kind, config)
SELECT
  id,
  'stock_threshold',
  jsonb_build_object(
    'threshold', stock_threshold,
    'scope_kind', stock_scope_kind,
    'scope_id', stock_scope_id
  )
FROM public.rules
WHERE stock_threshold IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Step 3: drop the inline columns from rules.
--
-- RLS audit before the drop:
--   - rules_select_storefront_safe (created in migration 31) does NOT
--     reference any inline condition column — only `active` and
--     `requires_code` (which stays). Safe.
--   - rules_admin_write / rules_select_admin_all are permission-only. Safe.
--   - rule_scopes_select_storefront_safe references rules.active and
--     rules.requires_code (via EXISTS) — both stay. Safe.
--   - rule_conditions_select_storefront_safe (just created above)
--     references the same — stays.
--   - The CHECK constraints on rules referencing these columns will be
--     dropped automatically when the columns drop (they're column-level
--     CHECKs from ALTER TABLE ... ADD CONSTRAINT).
-- ---------------------------------------------------------------------------

-- Drop constraints that reference the columns being dropped.
ALTER TABLE public.rules
  DROP CONSTRAINT IF EXISTS rules_user_type_chk,
  DROP CONSTRAINT IF EXISTS rules_time_window_chk,
  DROP CONSTRAINT IF EXISTS rules_min_subtotal_chk,
  DROP CONSTRAINT IF EXISTS rules_min_item_count_chk,
  DROP CONSTRAINT IF EXISTS rules_max_uses_total_chk,
  DROP CONSTRAINT IF EXISTS rules_max_uses_per_customer_chk,
  DROP CONSTRAINT IF EXISTS rules_stock_scope_pair_chk,
  DROP CONSTRAINT IF EXISTS rules_stock_scope_kind_chk,
  DROP CONSTRAINT IF EXISTS rules_stock_pair_chk;

ALTER TABLE public.rules
  DROP COLUMN IF EXISTS starts_at,
  DROP COLUMN IF EXISTS ends_at,
  DROP COLUMN IF EXISTS user_type,
  DROP COLUMN IF EXISTS min_subtotal,
  DROP COLUMN IF EXISTS min_item_count,
  DROP COLUMN IF EXISTS max_uses_total,
  DROP COLUMN IF EXISTS max_uses_per_customer,
  DROP COLUMN IF EXISTS stock_threshold,
  DROP COLUMN IF EXISTS stock_scope_kind,
  DROP COLUMN IF EXISTS stock_scope_id;

COMMENT ON TABLE public.rules IS
'Rules in v2.1 (Path A) carry: identity (name, description, active), action shape (kind, discount_value, waiver fields, bundle fields), code requirement flag (requires_code), and post-eligibility behaviour (stacking_mode, priority, current_uses, enforce_limits). The "when" — conditions — moved to rule_conditions where they''re typed + jsonb-configured for future extensibility.';

NOTIFY pgrst, 'reload schema';
