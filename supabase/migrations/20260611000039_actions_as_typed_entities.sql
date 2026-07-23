-- =============================================================================
-- Offers engine v2.4 — Actions as first-class typed entities.
--
-- Parallel to the conditions refactor (migration 34): the action a rule
-- performs is now a typed row in `rule_actions` with a jsonb config,
-- not inline columns on `rules`. Three kinds:
--
--   price_discount          → { mode: 'percent' | 'flat', value: number }
--   product_bundle          → { trigger_scope_kind, trigger_scope_id,
--                               trigger_quantity, reward_scope_kind,
--                               reward_scope_id, reward_quantity,
--                               reward_discount, max_applications_per_cart }
--   service_cost_exception  → { fee_kind: 'delivery' | 'cod' | 'all',
--                               threshold: null | { kind: 'cart_total' |
--                               'products_total', value: number },
--                               waive_customer_charge: boolean }
--
-- Consolidation: the six legacy kinds (percent_discount, flat_discount,
-- bundle_bxgy, waive_shipping, waive_cod, waive_all_fees) collapse into
-- three action kinds with the per-kind sub-mode inside config.
--
-- Each rule has exactly one action (UNIQUE on rule_id). This matches the
-- current 1:1 relationship while leaving the table extensible to
-- "multiple stacked actions per rule" later without schema change.
-- =============================================================================

-- ─── Step 1: create rule_actions ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rule_actions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id     uuid NOT NULL UNIQUE REFERENCES public.rules(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CHECK (kind IN ('price_discount', 'product_bundle', 'service_cost_exception')),
  CHECK (jsonb_typeof(config) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_rule_actions_rule ON public.rule_actions(rule_id);
CREATE INDEX IF NOT EXISTS idx_rule_actions_kind ON public.rule_actions(kind);

ALTER TABLE public.rule_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rule_actions_admin_write"
  ON public.rule_actions FOR ALL TO authenticated
  USING (public.has_permission('manage:discounts'))
  WITH CHECK (public.has_permission('manage:discounts'));

CREATE POLICY "rule_actions_select_storefront_safe"
  ON public.rule_actions FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.rules r
    WHERE r.id = rule_id
      AND r.active = true
      AND r.requires_code = false
  ));

CREATE POLICY "rule_actions_select_admin_all"
  ON public.rule_actions FOR SELECT TO authenticated
  USING (public.has_permission('manage:discounts'));

COMMENT ON TABLE public.rule_actions IS
'First-class action entity (v2.4). Three kinds: price_discount, product_bundle, service_cost_exception. Each rule has exactly one action row (UNIQUE on rule_id). Sub-modes live in jsonb config.';

-- ─── Step 2: backfill from existing rule columns ────────────────────

-- price_discount: percent_discount + flat_discount
INSERT INTO public.rule_actions (rule_id, kind, config)
SELECT
  id,
  'price_discount',
  jsonb_build_object(
    'mode',  CASE WHEN kind = 'percent_discount' THEN 'percent' ELSE 'flat' END,
    'value', COALESCE(discount_value, 0)
  )
FROM public.rules
WHERE kind IN ('percent_discount', 'flat_discount');

-- product_bundle: bundle_bxgy
INSERT INTO public.rule_actions (rule_id, kind, config)
SELECT
  id,
  'product_bundle',
  jsonb_strip_nulls(jsonb_build_object(
    'trigger_scope_kind',          trigger_scope_kind,
    'trigger_scope_id',             trigger_scope_id,
    'trigger_quantity',             trigger_quantity,
    'reward_scope_kind',            reward_scope_kind,
    'reward_scope_id',              reward_scope_id,
    'reward_quantity',              reward_quantity,
    'reward_discount',              reward_discount,
    'max_applications_per_cart',    max_applications_per_cart
  ))
FROM public.rules
WHERE kind = 'bundle_bxgy';

-- service_cost_exception: waive_shipping + waive_cod + waive_all_fees
INSERT INTO public.rule_actions (rule_id, kind, config)
SELECT
  id,
  'service_cost_exception',
  jsonb_build_object(
    'fee_kind',
      CASE
        WHEN kind = 'waive_shipping' THEN 'delivery'
        WHEN kind = 'waive_cod'      THEN 'cod'
        ELSE 'all'
      END,
    'threshold',
      CASE
        WHEN waive_threshold_kind IS NULL THEN NULL
        ELSE jsonb_build_object(
          'kind',  waive_threshold_kind,
          'value', COALESCE(waive_threshold_value, 0)
        )
      END,
    'waive_customer_charge', COALESCE(waive_customer_charge, true)
  )
FROM public.rules
WHERE kind IN ('waive_shipping', 'waive_cod', 'waive_all_fees');

-- ─── Step 3: tighten rules.kind to the consolidated 3-value enum ────
-- The CHECK constraint was named "rules_kind_check" (created from
-- ALTER TABLE in migration 27). Drop + re-create.
ALTER TABLE public.rules
  DROP CONSTRAINT IF EXISTS rules_kind_check,
  DROP CONSTRAINT IF EXISTS offer_rules_kind_check;

UPDATE public.rules
SET kind = CASE
  WHEN kind IN ('percent_discount', 'flat_discount')                    THEN 'price_discount'
  WHEN kind = 'bundle_bxgy'                                              THEN 'product_bundle'
  WHEN kind IN ('waive_shipping', 'waive_cod', 'waive_all_fees')         THEN 'service_cost_exception'
  ELSE kind
END;

ALTER TABLE public.rules
  ADD CONSTRAINT rules_kind_check
  CHECK (kind IN ('price_discount', 'product_bundle', 'service_cost_exception'));

-- ─── Step 4: drop the now-redundant per-action columns from rules ───
ALTER TABLE public.rules
  DROP COLUMN IF EXISTS discount_value,
  DROP COLUMN IF EXISTS trigger_scope_kind,
  DROP COLUMN IF EXISTS trigger_scope_id,
  DROP COLUMN IF EXISTS trigger_quantity,
  DROP COLUMN IF EXISTS reward_scope_kind,
  DROP COLUMN IF EXISTS reward_scope_id,
  DROP COLUMN IF EXISTS reward_quantity,
  DROP COLUMN IF EXISTS reward_discount,
  DROP COLUMN IF EXISTS max_applications_per_cart,
  DROP COLUMN IF EXISTS waive_threshold_kind,
  DROP COLUMN IF EXISTS waive_threshold_value,
  DROP COLUMN IF EXISTS waive_customer_charge;

COMMENT ON TABLE public.rules IS
'Slim rule (v2.4). Identity (name, description, active) + action_kind discriminator + post-eligibility behaviour. Action config in rule_actions; conditions in rule_conditions; codes in rule_codes.';

COMMENT ON COLUMN public.rules.kind IS
'Mirror of rule_actions.kind for fast filtering. One of: price_discount, product_bundle, service_cost_exception.';

NOTIFY pgrst, 'reload schema';
