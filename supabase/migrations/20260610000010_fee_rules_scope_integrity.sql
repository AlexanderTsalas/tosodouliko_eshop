-- =============================================================================
-- Enforce polymorphic FK integrity on fee_rules.scope_id.
--
-- Background:
--   fee_rules has a polymorphic FK pattern:
--     scope_type IN ('global','category','product','variant')
--     scope_id   uuid pointing to the corresponding table
--
--   The original schema (20260520000001_fees_foundation.sql:128-135) comments
--   that "App layer is responsible for validating the type matches" and the
--   orphan risk is "mitigated by an admin cleanup job" — that job doesn't
--   exist. Any code path bypassing app validation can insert a rule with
--   scope_id pointing at the wrong table, OR a rule for a category that was
--   subsequently deleted (which would silently keep firing or match nothing).
--
-- Fix:
--   1. A BEFORE INSERT/UPDATE trigger that validates scope_id exists in
--      the table named by scope_type. Refuses bad inserts at the DB layer.
--   2. AFTER DELETE triggers on each of the three target tables
--      (categories, products, product_variants) that delete any fee_rules
--      pointing at the deleted row. Cleans up orphans automatically.
--
-- Idempotent + safe to re-run. Existing valid rules pass unchanged; any
-- pre-existing orphan rules (created before this trigger) survive — they're
-- not retroactively cleaned. If you want to audit + delete pre-existing
-- orphans, run the helper query in the comment at the bottom of this file.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.validate_fee_rule_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_exists boolean;
BEGIN
  -- Global scope: scope_id must be NULL (enforced by existing CHECK
  -- constraint, but double-check here for clarity).
  IF NEW.scope_type = 'global' THEN
    IF NEW.scope_id IS NOT NULL THEN
      RAISE EXCEPTION 'fee_rules: scope_type=global requires scope_id IS NULL';
    END IF;
    RETURN NEW;
  END IF;

  -- Non-global scopes require scope_id to point at an existing row in
  -- the corresponding table.
  IF NEW.scope_id IS NULL THEN
    RAISE EXCEPTION 'fee_rules: scope_type=% requires non-null scope_id', NEW.scope_type;
  END IF;

  IF NEW.scope_type = 'category' THEN
    SELECT EXISTS (SELECT 1 FROM public.categories WHERE id = NEW.scope_id) INTO v_exists;
  ELSIF NEW.scope_type = 'product' THEN
    SELECT EXISTS (SELECT 1 FROM public.products WHERE id = NEW.scope_id) INTO v_exists;
  ELSIF NEW.scope_type = 'variant' THEN
    SELECT EXISTS (SELECT 1 FROM public.product_variants WHERE id = NEW.scope_id) INTO v_exists;
  ELSE
    RAISE EXCEPTION 'fee_rules: unknown scope_type %', NEW.scope_type;
  END IF;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'fee_rules: scope_id % does not exist in % table',
      NEW.scope_id, NEW.scope_type;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fee_rules_validate_scope ON public.fee_rules;
CREATE TRIGGER fee_rules_validate_scope
  BEFORE INSERT OR UPDATE OF scope_type, scope_id ON public.fee_rules
  FOR EACH ROW EXECUTE FUNCTION public.validate_fee_rule_scope();

-- ─────────────────────────────────────────────────────────────────────
-- Auto-cleanup orphan fee_rules when the referenced row is deleted.
-- Cascade-like behavior via AFTER DELETE triggers on each target table.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cleanup_fee_rules_on_category_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.fee_rules
  WHERE scope_type = 'category' AND scope_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_fee_rules_on_product_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.fee_rules
  WHERE scope_type = 'product' AND scope_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_fee_rules_on_variant_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.fee_rules
  WHERE scope_type = 'variant' AND scope_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS categories_cleanup_fee_rules ON public.categories;
CREATE TRIGGER categories_cleanup_fee_rules
  AFTER DELETE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_fee_rules_on_category_delete();

DROP TRIGGER IF EXISTS products_cleanup_fee_rules ON public.products;
CREATE TRIGGER products_cleanup_fee_rules
  AFTER DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_fee_rules_on_product_delete();

DROP TRIGGER IF EXISTS variants_cleanup_fee_rules ON public.product_variants;
CREATE TRIGGER variants_cleanup_fee_rules
  AFTER DELETE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_fee_rules_on_variant_delete();

-- Helper query for finding pre-existing orphan rules (not auto-run):
--
--   SELECT fr.* FROM public.fee_rules fr
--   WHERE fr.scope_type = 'category' AND NOT EXISTS (SELECT 1 FROM public.categories WHERE id = fr.scope_id)
--   UNION ALL
--   SELECT fr.* FROM public.fee_rules fr
--   WHERE fr.scope_type = 'product' AND NOT EXISTS (SELECT 1 FROM public.products WHERE id = fr.scope_id)
--   UNION ALL
--   SELECT fr.* FROM public.fee_rules fr
--   WHERE fr.scope_type = 'variant' AND NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = fr.scope_id);

NOTIFY pgrst, 'reload schema';
