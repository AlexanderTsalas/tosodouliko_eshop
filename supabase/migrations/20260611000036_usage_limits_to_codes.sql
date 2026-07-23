-- =============================================================================
-- Offers engine v2.2 — Move usage limits from rule conditions to rule_codes.
--
-- Per the design call: limits are a code concept (codes get exhausted,
-- codes have per-customer entitlements), not a generalized rule condition.
-- Auto-apply rules (no codes) lose their usage-limit feature — that's
-- the trade-off explicitly accepted.
--
-- Changes:
--   1. Add max_uses_total, max_uses_per_customer, current_uses,
--      enforce_limits columns to rule_codes
--   2. Create rule_code_customer_usage table (replaces rule_customer_usage,
--      now keyed on rule_code_id + customer_id)
--   3. Backfill from any existing usage_limit_total / usage_limit_per_customer
--      conditions onto the rule's codes (best-effort — auto-apply rules
--      with usage limits simply lose them)
--   4. Drop usage_limit_total + usage_limit_per_customer condition rows
--      AND remove them from the CHECK constraint on rule_conditions.kind
--   5. Drop rules.current_uses + rules.enforce_limits (now on codes)
--   6. Drop rule_customer_usage table (replaced by rule_code_customer_usage)
--   7. Replace record_rule_usage(p_rule_ids, p_customer_id) with
--      record_code_usage(p_code_ids, p_customer_id)
-- =============================================================================

-- ─── Step 1: add usage-limit columns to rule_codes ───────────────────
ALTER TABLE public.rule_codes
  ADD COLUMN IF NOT EXISTS max_uses_total         integer,
  ADD COLUMN IF NOT EXISTS max_uses_per_customer  integer,
  ADD COLUMN IF NOT EXISTS current_uses           integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS enforce_limits         boolean NOT NULL DEFAULT false;

ALTER TABLE public.rule_codes
  ADD CONSTRAINT rule_codes_max_uses_total_chk
    CHECK (max_uses_total IS NULL OR max_uses_total > 0),
  ADD CONSTRAINT rule_codes_max_uses_per_customer_chk
    CHECK (max_uses_per_customer IS NULL OR max_uses_per_customer > 0),
  ADD CONSTRAINT rule_codes_current_uses_chk
    CHECK (current_uses >= 0);

-- ─── Step 2: per-code per-customer usage table ───────────────────────
CREATE TABLE IF NOT EXISTS public.rule_code_customer_usage (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_code_id   uuid NOT NULL REFERENCES public.rule_codes(id) ON DELETE CASCADE,
  customer_id    uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  use_count      integer NOT NULL DEFAULT 0,
  last_used_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_code_id, customer_id),
  CHECK (use_count >= 0)
);
CREATE INDEX IF NOT EXISTS idx_rccu_customer
  ON public.rule_code_customer_usage(customer_id);

ALTER TABLE public.rule_code_customer_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rccu_admin_read"
  ON public.rule_code_customer_usage FOR SELECT TO authenticated
  USING (public.has_permission('manage:discounts'));
CREATE POLICY "rccu_select_own"
  ON public.rule_code_customer_usage FOR SELECT TO authenticated
  USING (customer_id IN (SELECT id FROM public.customers WHERE auth_user_id = auth.uid()));
CREATE POLICY "rccu_admin_write"
  ON public.rule_code_customer_usage FOR ALL TO authenticated
  USING (public.has_permission('manage:discounts'))
  WITH CHECK (public.has_permission('manage:discounts'));

-- ─── Step 3: backfill from condition rows onto rule_codes ────────────
-- For each rule that has a usage_limit_total condition AND at least
-- one code, copy the limit onto ALL of that rule's codes. Same for
-- usage_limit_per_customer. Rules without codes lose the limit.
UPDATE public.rule_codes rc
SET max_uses_total = (
  SELECT (config->>'max')::int
  FROM public.rule_conditions
  WHERE rule_id = rc.rule_id AND kind = 'usage_limit_total'
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM public.rule_conditions
  WHERE rule_id = rc.rule_id AND kind = 'usage_limit_total'
);

UPDATE public.rule_codes rc
SET max_uses_per_customer = (
  SELECT (config->>'max')::int
  FROM public.rule_conditions
  WHERE rule_id = rc.rule_id AND kind = 'usage_limit_per_customer'
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM public.rule_conditions
  WHERE rule_id = rc.rule_id AND kind = 'usage_limit_per_customer'
);

-- enforce_limits flag — pull from the rule that owned the limit conditions.
UPDATE public.rule_codes rc
SET enforce_limits = COALESCE(
  (SELECT r.enforce_limits FROM public.rules r WHERE r.id = rc.rule_id),
  false
)
WHERE rc.rule_id IS NOT NULL;

-- current_uses backfill — best effort from the legacy rules.current_uses.
UPDATE public.rule_codes rc
SET current_uses = COALESCE(
  (SELECT r.current_uses FROM public.rules r WHERE r.id = rc.rule_id),
  0
);

-- ─── Step 4: drop usage_limit_* conditions + tighten CHECK ───────────
DELETE FROM public.rule_conditions
WHERE kind IN ('usage_limit_total', 'usage_limit_per_customer');

ALTER TABLE public.rule_conditions
  DROP CONSTRAINT IF EXISTS rule_conditions_kind_check;
ALTER TABLE public.rule_conditions
  ADD CONSTRAINT rule_conditions_kind_check
  CHECK (kind IN (
    'timeframe',
    'user_type',
    'min_subtotal',
    'min_item_count',
    'stock_threshold'
  ));

-- ─── Step 5: drop now-unused columns from rules ──────────────────────
ALTER TABLE public.rules
  DROP COLUMN IF EXISTS current_uses,
  DROP COLUMN IF EXISTS enforce_limits;

-- ─── Step 6: drop rule_customer_usage (replaced by rule_code_customer_usage) ─
DROP TABLE IF EXISTS public.rule_customer_usage;

-- ─── Step 7: replace record_rule_usage with record_code_usage ────────
DROP FUNCTION IF EXISTS public.record_rule_usage(uuid[], uuid);

CREATE OR REPLACE FUNCTION public.record_code_usage(
  p_code_ids   uuid[],
  p_customer_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_code_ids IS NULL OR array_length(p_code_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Atomic counter bump on each code.
  UPDATE public.rule_codes
  SET current_uses = current_uses + 1
  WHERE id = ANY(p_code_ids);

  -- Per-customer counters (upsert) — only if a customer was provided.
  IF p_customer_id IS NOT NULL THEN
    INSERT INTO public.rule_code_customer_usage (rule_code_id, customer_id, use_count, last_used_at)
    SELECT id, p_customer_id, 1, now()
    FROM unnest(p_code_ids) AS id
    ON CONFLICT (rule_code_id, customer_id) DO UPDATE
    SET use_count = rule_code_customer_usage.use_count + 1,
        last_used_at = now();
  END IF;
END;
$$;

COMMENT ON FUNCTION public.record_code_usage(uuid[], uuid) IS
'Bumps the total + per-customer usage counters for the given code IDs. Called from placeOrder after order commit when at least one rule_code applied.';

-- ─── Step 8: nullable scope_id on stock_threshold conditions ─────────
-- The Zod schema previously required UUID at create time. This created
-- a "save fails until configured" trap. We now allow null scope_id —
-- the evaluator returns false when the condition is incomplete, so it
-- has no engine effect but the row exists and can be incrementally
-- configured in the UI without losing draft state. The actual nullable
-- coercion happens at the Zod schema layer; the DB column is already
-- jsonb and accepts any shape.

NOTIFY pgrst, 'reload schema';
