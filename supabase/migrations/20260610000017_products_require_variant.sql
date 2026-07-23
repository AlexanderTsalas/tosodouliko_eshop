-- =============================================================================
-- DB-level guarantee: every product MUST have at least one variant.
--
-- Background:
--   The application-layer createProduct action already enforces
--   `variants.length >= 1` via Zod. The product form refuses to enable
--   the submit button until the admin has staged at least one variant.
--   This migration is defense-in-depth — a deferred constraint trigger
--   that catches the invariant at the DATABASE layer too. Direct
--   inserts (scripts, future actions, manual SQL) that bypass the
--   action layer will hit this constraint and fail at commit time.
--
-- Why a deferred CONSTRAINT TRIGGER rather than a CHECK or FK:
--   - A FK can't express "must exist in another table" without a
--     mandatory FK direction (products would need a NOT NULL FK to
--     a variant — but variants reference products, not the other way
--     around).
--   - A regular CHECK can't query other tables.
--   - A deferred CONSTRAINT TRIGGER runs at COMMIT time, after the
--     entire transaction (product INSERT + variants INSERT) has
--     finished. By then the existence query is meaningful.
--
-- Failure mode:
--   - Direct INSERT INTO products (...) — without a follow-up variant
--     insert in the same transaction — fails at COMMIT with a clear
--     "Products must have at least one variant" message.
--   - createProduct's atomic flow (product INSERT → variants INSERT
--     in one transaction) passes the check because by COMMIT time the
--     variant exists.
--   - Deleting the last variant of a product is blocked too (we run
--     the check on both INSERT and DELETE of variants).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ensure_product_has_variant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_product_id uuid;
  v_count integer;
BEGIN
  -- Resolve which product to check. INSERT-on-products uses NEW.id;
  -- DELETE-on-variants uses OLD.product_id; UPDATE-on-variants of
  -- product_id uses OLD.product_id (the FROM side) so an orphan
  -- product isn't created by moving the variant elsewhere.
  v_product_id := CASE TG_TABLE_NAME
    WHEN 'products' THEN NEW.id
    WHEN 'product_variants' THEN
      CASE TG_OP
        WHEN 'DELETE' THEN OLD.product_id
        WHEN 'UPDATE' THEN OLD.product_id
        ELSE NEW.product_id  -- INSERT, shouldn't hit but guard
      END
    ELSE NULL
  END;
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
'Deferred constraint trigger that fires at COMMIT time to guarantee every product has at least one variant. Catches direct INSERTs into products that skip the variants step, and DELETEs of the last variant of a product. The application layer (createProduct action) enforces the same invariant up-front; this is defense-in-depth.';

-- The TRIGGER on products fires after every INSERT and runs DEFERRED
-- so it executes at COMMIT, after the variants in the same txn land.
DROP TRIGGER IF EXISTS trg_products_require_variant ON public.products;
CREATE CONSTRAINT TRIGGER trg_products_require_variant
  AFTER INSERT ON public.products
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_product_has_variant();

-- The TRIGGER on product_variants fires after DELETE/UPDATE so an
-- admin can't strand a product by removing the last variant. Insert-
-- side checks aren't needed (insertion can only INCREASE variant
-- count, never decrease).
DROP TRIGGER IF EXISTS trg_variants_require_at_least_one ON public.product_variants;
CREATE CONSTRAINT TRIGGER trg_variants_require_at_least_one
  AFTER DELETE OR UPDATE OF product_id ON public.product_variants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_product_has_variant();

NOTIFY pgrst, 'reload schema';
