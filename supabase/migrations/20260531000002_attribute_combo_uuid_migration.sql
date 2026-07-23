-- =============================================================================
-- Attribute combo: store UUIDs of attribute_values instead of value text.
--
-- Before: product_variants.attribute_combo = {"flavour-profile": "Strawberry"}
-- After:  product_variants.attribute_combo = {"flavour-profile": "<uuid-of-strawberry-attribute-value>"}
--
-- The slug column on attribute_values supports stable URLs across display
-- renames: rename "Strawberry" → "Fragola" leaves the URL slug "strawberry"
-- intact and every variant continues to render the new display text via a
-- join (no per-variant rewrite needed).
--
-- Two new triggers enforce the invariants the schema couldn't FK:
--   1. Every UUID in a variant's attribute_combo references a real
--      attribute_values row whose attribute_id matches the combo key's slug.
--   2. All active variants of a product share the same set of
--      jsonb_object_keys(attribute_combo) — the matrix-shape rule that
--      prevents orphan/mixed-shape variant sets.
--
-- Test data is fully truncated (the DB has no production data yet) so the
-- migration doesn't need a backfill.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. New slug column on attribute_values
-- ---------------------------------------------------------------------------

ALTER TABLE public.attribute_values
  ADD COLUMN IF NOT EXISTS slug text;

-- Unique slug per attribute (different attributes can independently use
-- the same slug, e.g. attribute "size" slug "s" and attribute "shoe-size"
-- slug "s" should not collide).
CREATE UNIQUE INDEX IF NOT EXISTS uq_attribute_values_slug_per_attribute
  ON public.attribute_values (attribute_id, slug);

COMMENT ON COLUMN public.attribute_values.slug IS
  'URL-stable slug for this value (e.g. "fraoula"). Independent of the display value, so renaming "Φράουλα" → "Strawberry" leaves URLs unchanged.';

-- ---------------------------------------------------------------------------
-- 2. Truncate test data — cascades through every downstream FK
-- ---------------------------------------------------------------------------

TRUNCATE
  public.attributes,
  public.attribute_values,
  public.products,
  public.product_variants,
  public.categories
CASCADE;

-- Any rule documents that referenced the now-truncated values become stale;
-- the cascading truncate above doesn't touch jsonb-encoded references.
-- Reset the rule fields to empty so categories don't carry orphan filters.
UPDATE public.categories
   SET auto_rules = NULL,
       mode = 'manual';

-- ---------------------------------------------------------------------------
-- 3. Make slug NOT NULL going forward (now that the table is empty)
-- ---------------------------------------------------------------------------

ALTER TABLE public.attribute_values
  ALTER COLUMN slug SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Trigger: validate every (slug, uuid) entry in attribute_combo references
--    a real attribute_values row under the matching attribute.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_attribute_combo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  combo_key text;
  combo_val text;
  matched_attribute_id uuid;
BEGIN
  IF NEW.attribute_combo IS NULL THEN
    RETURN NEW;
  END IF;

  FOR combo_key, combo_val IN
    SELECT * FROM jsonb_each_text(NEW.attribute_combo)
  LOOP
    -- Resolve the attribute by slug.
    SELECT id INTO matched_attribute_id
      FROM public.attributes
     WHERE slug = combo_key;
    IF matched_attribute_id IS NULL THEN
      RAISE EXCEPTION
        'attribute_combo key "%" does not match any attributes.slug', combo_key;
    END IF;

    -- Verify the value UUID exists under the matched attribute.
    PERFORM 1
      FROM public.attribute_values
     WHERE id = combo_val::uuid
       AND attribute_id = matched_attribute_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'attribute_combo["%"] = % does not reference a valid attribute_value for attribute "%"',
        combo_key, combo_val, combo_key;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_attribute_combo ON public.product_variants;
CREATE TRIGGER trg_validate_attribute_combo
  BEFORE INSERT OR UPDATE OF attribute_combo
  ON public.product_variants
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_attribute_combo();

-- ---------------------------------------------------------------------------
-- 5. Trigger: enforce matrix-shape — all variants of one product must share
--    the same set of jsonb_object_keys(attribute_combo).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_variant_matrix_shape()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  new_keys text[];
  existing_keys text[];
BEGIN
  -- Collect the new row's keys (sorted, distinct).
  IF NEW.attribute_combo IS NULL THEN
    new_keys := ARRAY[]::text[];
  ELSE
    SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::text[])
      INTO new_keys
      FROM jsonb_object_keys(NEW.attribute_combo) AS k;
  END IF;

  -- Compare against any other variant for the same product. We sample one
  -- sibling: if it disagrees, raise. (A single sibling check is sufficient
  -- because every existing sibling already conforms to the same shape, by
  -- induction on this very trigger.)
  SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::text[])
    INTO existing_keys
    FROM (
      SELECT jsonb_object_keys(attribute_combo) AS k
        FROM public.product_variants
       WHERE product_id = NEW.product_id
         AND id <> NEW.id
       LIMIT 1
    ) sub;

  IF existing_keys IS NOT NULL
     AND array_length(existing_keys, 1) IS NOT NULL
     AND new_keys <> existing_keys THEN
    RAISE EXCEPTION
      'matrix-shape violation: variant attribute_combo keys % do not match the product''s established axes %',
      new_keys, existing_keys;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_variant_matrix_shape ON public.product_variants;
CREATE TRIGGER trg_validate_variant_matrix_shape
  BEFORE INSERT OR UPDATE OF attribute_combo, product_id
  ON public.product_variants
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_variant_matrix_shape();
