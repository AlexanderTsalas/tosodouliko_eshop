-- =============================================================================
-- Fix: matrix-shape trigger was unpacking jsonb_object_keys before LIMIT 1, so
-- it only ever read a single key from a sibling variant — comparing against
-- the new row's full key set always failed for products with >1 axis.
--
-- This migration replaces the function with one that picks a sibling first
-- (LIMIT 1 in the inner subquery), then enumerates *all* keys of that
-- sibling for the comparison.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.validate_variant_matrix_shape()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  new_keys text[];
  existing_keys text[];
  sibling_combo jsonb;
BEGIN
  -- Collect the new row's keys (sorted, distinct).
  IF NEW.attribute_combo IS NULL THEN
    new_keys := ARRAY[]::text[];
  ELSE
    SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::text[])
      INTO new_keys
      FROM jsonb_object_keys(NEW.attribute_combo) AS k;
  END IF;

  -- Pick one sibling variant for the same product. (Every sibling already
  -- conforms to the established shape, by induction on this trigger, so any
  -- one of them is a valid reference.)
  SELECT attribute_combo
    INTO sibling_combo
    FROM public.product_variants
   WHERE product_id = NEW.product_id
     AND id <> NEW.id
   LIMIT 1;

  -- No sibling → this is the first variant on the product; shape becomes
  -- whatever this row says it is. Allow.
  IF sibling_combo IS NULL THEN
    RETURN NEW;
  END IF;

  -- Enumerate every key of the chosen sibling for the comparison.
  SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::text[])
    INTO existing_keys
    FROM jsonb_object_keys(sibling_combo) AS k;

  IF new_keys <> existing_keys THEN
    RAISE EXCEPTION
      'matrix-shape violation: variant attribute_combo keys % do not match the product''s established axes %',
      new_keys, existing_keys;
  END IF;

  RETURN NEW;
END;
$$;
