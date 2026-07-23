-- =============================================================================
-- Offers engine v2.5 — Codes as standalone first-class entities.
--
-- Codes were previously tied to one rule each (rule_codes.rule_id NOT NULL).
-- The new model:
--   - A code is created once. The `code` string is globally UNIQUE.
--   - A code can be attached to MULTIPLE rules and/or offers via
--     `code_attachments` (target_kind: 'rule' | 'offer', target_id uuid).
--   - When entered at checkout, the engine fires every rule the code
--     reaches — directly attached, or attached to a parent offer of the
--     rule. This matches the user's "attach to rule OR offer" semantics.
--   - Standalone create + later assignment ("create the code, then go
--     decide where it applies") supported by the (target_kind, target_id)
--     being nullable at code-create time — code lives without attachments
--     until you add them.
--
-- Migration steps:
--   1. Rename `rule_codes` → `codes`. Drop rule_id NOT NULL.
--   2. Create `code_attachments` junction. Backfill from the old rule_id
--      column on every existing code.
--   3. Migrate the customer whitelist: `rule_code_customers` →
--      `code_customers` (rename column `rule_code_id` → `code_id`).
--   4. Migrate the per-customer usage table: `rule_code_customer_usage` →
--      `code_customer_usage`.
--   5. Update `record_code_usage(p_code_ids, p_customer_id)` to read
--      from the renamed tables.
--   6. Replace the requires_code denorm maintenance: handled in TS now
--      (action layer flips rules.requires_code based on
--      code_attachments existence — direct OR via parent offer).
-- =============================================================================

-- ─── Step 1: rename rule_codes → codes ──────────────────────────────
ALTER TABLE IF EXISTS public.rule_codes RENAME TO codes;

-- Drop the old UNIQUE(code, rule_id) constraint; replace with UNIQUE(code).
-- (Codes that previously coexisted under different rules will need to
-- consolidate manually — for the dev environment we accept this.)
DO $$
BEGIN
  -- Constraint name was rule_codes_code_rule_id_key (Postgres default
  -- for UNIQUE in CREATE TABLE).
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rule_codes_code_rule_id_key'
  ) THEN
    ALTER TABLE public.codes DROP CONSTRAINT rule_codes_code_rule_id_key;
  END IF;
END $$;

-- If duplicate `code` values exist across different rule_ids, the
-- UNIQUE(code) add would fail. Detect + raise rather than silently
-- corrupting state.
DO $$
DECLARE
  dup_count int;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT code FROM public.codes GROUP BY code HAVING COUNT(*) > 1
  ) t;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Cannot migrate codes: % duplicate code values exist across rules. Consolidate manually before re-running.', dup_count;
  END IF;
END $$;

ALTER TABLE public.codes
  ADD CONSTRAINT codes_code_key UNIQUE (code);

-- rule_id becomes nullable — codes can exist standalone.
ALTER TABLE public.codes ALTER COLUMN rule_id DROP NOT NULL;

-- ─── Step 2: code_attachments junction + backfill ────────────────────
CREATE TABLE IF NOT EXISTS public.code_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id       uuid NOT NULL REFERENCES public.codes(id) ON DELETE CASCADE,
  target_kind   text NOT NULL,
  target_id     uuid NOT NULL,
  added_at      timestamptz NOT NULL DEFAULT now(),
  added_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  CHECK (target_kind IN ('rule', 'offer')),
  UNIQUE (code_id, target_kind, target_id)
);
CREATE INDEX IF NOT EXISTS idx_code_attachments_code
  ON public.code_attachments(code_id);
CREATE INDEX IF NOT EXISTS idx_code_attachments_target
  ON public.code_attachments(target_kind, target_id);

ALTER TABLE public.code_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "code_attachments_admin_write"
  ON public.code_attachments FOR ALL TO authenticated
  USING (public.has_permission('manage:discounts'))
  WITH CHECK (public.has_permission('manage:discounts'));
CREATE POLICY "code_attachments_select_admin_all"
  ON public.code_attachments FOR SELECT TO authenticated
  USING (public.has_permission('manage:discounts'));
-- No public SELECT — code attachments are admin-visible only.

-- Backfill: every existing codes row with a non-null rule_id becomes one
-- attachment row pointing at that rule.
INSERT INTO public.code_attachments (code_id, target_kind, target_id, added_by)
SELECT id, 'rule', rule_id, created_by
FROM public.codes
WHERE rule_id IS NOT NULL;

-- Drop the now-redundant rule_id column from codes.
ALTER TABLE public.codes DROP COLUMN IF EXISTS rule_id;

COMMENT ON TABLE public.codes IS
'Standalone code entities (v2.5). One code = one row globally UNIQUE on `code`. Attached to rules and/or offers via code_attachments. Per-code usage limits + enforce flag live here; per-customer counters in code_customer_usage; customer whitelists in code_customers.';

-- ─── Step 3: rename rule_code_customers → code_customers ─────────────
ALTER TABLE IF EXISTS public.rule_code_customers RENAME TO code_customers;
ALTER TABLE IF EXISTS public.code_customers
  RENAME COLUMN rule_code_id TO code_id;

-- Update the UNIQUE constraint name (default was rule_code_customers_*).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rule_code_customers_rule_code_id_customer_id_key'
  ) THEN
    ALTER TABLE public.code_customers
      DROP CONSTRAINT rule_code_customers_rule_code_id_customer_id_key;
    ALTER TABLE public.code_customers
      ADD CONSTRAINT code_customers_code_id_customer_id_key UNIQUE (code_id, customer_id);
  END IF;
END $$;

-- ─── Step 4: rename rule_code_customer_usage → code_customer_usage ─
ALTER TABLE IF EXISTS public.rule_code_customer_usage
  RENAME TO code_customer_usage;
ALTER TABLE IF EXISTS public.code_customer_usage
  RENAME COLUMN rule_code_id TO code_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rule_code_customer_usage_rule_code_id_customer_id_key'
  ) THEN
    ALTER TABLE public.code_customer_usage
      DROP CONSTRAINT rule_code_customer_usage_rule_code_id_customer_id_key;
    ALTER TABLE public.code_customer_usage
      ADD CONSTRAINT code_customer_usage_code_id_customer_id_key
      UNIQUE (code_id, customer_id);
  END IF;
END $$;

-- ─── Step 5: replace record_code_usage to reference renamed table ──
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

  UPDATE public.codes
  SET current_uses = current_uses + 1
  WHERE id = ANY(p_code_ids);

  IF p_customer_id IS NOT NULL THEN
    INSERT INTO public.code_customer_usage (code_id, customer_id, use_count, last_used_at)
    SELECT id, p_customer_id, 1, now()
    FROM unnest(p_code_ids) AS id
    ON CONFLICT (code_id, customer_id) DO UPDATE
    SET use_count = code_customer_usage.use_count + 1,
        last_used_at = now();
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
