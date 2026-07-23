-- =============================================================================
-- Fix: ensure_product_has_variant trigger function fails on product creation.
--
-- Background:
--   Migration 20260610000017_products_require_variant.sql created a
--   shared trigger function that fires from TWO different triggers:
--     1. AFTER INSERT ON products              — OLD does not exist
--     2. AFTER DELETE OR UPDATE ON variants    — OLD exists
--
--   The function used a SQL CASE expression to pick `v_product_id`
--   from NEW.id (when on products) vs OLD.product_id (when on
--   product_variants). The problem: plpgsql's CASE expression in an
--   assignment compiles all branches against the calling trigger's
--   record types. When fired from the products INSERT trigger, OLD
--   doesn't exist — so resolving `OLD.product_id` in any branch
--   raises:
--
--     record "old" has no field "product_id"
--
--   Even though the branch wouldn't logically execute (TG_TABLE_NAME
--   would match 'products' first), plpgsql still tries to evaluate
--   the field reference, which fails.
--
-- Fix:
--   Replace the CASE expression with IF/ELSIF statements. plpgsql IF
--   statements DO short-circuit at runtime — only the matching
--   branch's body is evaluated. So OLD.product_id is only accessed
--   inside the product_variants branch, which only runs when the
--   trigger was actually fired from product_variants (where OLD
--   exists and has a product_id column).
--
-- Safety:
--   - Identical semantics to the original (same product_id selection
--     logic per TG_TABLE_NAME / TG_OP)
--   - No schema change, just function body rewrite
--   - Triggers themselves stay unchanged (still DEFERRED, still on
--     the same tables/events)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ensure_product_has_variant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_product_id uuid;
  v_count integer;
BEGIN
  -- Resolve which product to check. Branches use IF/ELSIF so plpgsql
  -- only evaluates the body of the matching branch — OLD.product_id
  -- never gets touched when this fires from the products INSERT
  -- trigger (where OLD doesn't exist).
  IF TG_TABLE_NAME = 'products' THEN
    v_product_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'product_variants' THEN
    IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
      v_product_id := OLD.product_id;
    ELSE
      -- INSERT, shouldn't hit but guard
      v_product_id := NEW.product_id;
    END IF;
  ELSE
    v_product_id := NULL;
  END IF;

  IF v_product_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Skip the check if the product itself was deleted in this txn —
  -- variants cascade-delete via FK and we don't want to flag the
  -- intermediate state.
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_product_id) THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.product_variants
  WHERE product_id = v_product_id;

  IF v_count < 1 THEN
    RAISE EXCEPTION
      'Products must have at least one variant (product_id=%, variant_count=%)',
      v_product_id, v_count
      USING ERRCODE = 'check_violation',
            HINT = 'Insert at least one product_variants row in the same transaction as the products row, or add a new variant before removing the last one.';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.ensure_product_has_variant IS
'Deferred constraint trigger that fires at COMMIT time to guarantee every product has at least one variant. Catches direct INSERTs into products that skip the variants step, and DELETEs of the last variant of a product. Function body uses IF/ELSIF (not SQL CASE) so OLD.product_id is only resolved in the product_variants branches — required because the products INSERT trigger has no OLD record.';

NOTIFY pgrst, 'reload schema';
