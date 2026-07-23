-- =============================================================================
-- Refuse attribute_values deletion when any product_variant.attribute_combo
-- still references the row's UUID.
--
-- Counterpart to validate_attribute_combo (migration 20260531000002):
--
--   - validate_attribute_combo runs on WRITES to product_variants and
--     guarantees every UUID in attribute_combo points to a real
--     attribute_values row at insert/update time.
--
--   - This trigger runs on DELETES from attribute_values and guarantees
--     no live variant is left orphaned by the deletion. Together they
--     form a closed invariant: the JSONB column can never reference a
--     non-existent attribute_value, even though the schema cannot express
--     this as a foreign key.
--
-- Why this matters: an earlier admin action (deleteAttributeValue) shipped
-- with a broken in-use check that compared combo entries (UUIDs) against
-- the value's text label. The check never matched, letting admins delete
-- in-use values; the orphan UUIDs then leaked to the storefront facet
-- sidebar through the `?? key` fallback in getCatalogFacets. The action-
-- layer fix is necessary but insufficient — any future code path that
-- writes a DELETE against attribute_values (direct SQL, future admin
-- tooling, scripted cleanup) would re-introduce the same hazard.
--
-- The trigger raises a foreign_key_violation so PostgREST surfaces it
-- consistently with how it surfaces FK violations on other tables —
-- admin UI error handlers don't need a new branch.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.validate_attribute_value_not_in_use()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
  v_sample text;
BEGIN
  -- Count + sample one referencing variant for the error message. We scope
  -- to OLD.id only — different attribute_values can share a slug, and
  -- attribute_combo stores UUIDs not slug+value, so the only thing that
  -- matters is whether OLD.id appears anywhere in any combo's values.
  SELECT count(*),
         min(pv.id::text)
    INTO v_count, v_sample
    FROM public.product_variants pv,
         LATERAL jsonb_each_text(COALESCE(pv.attribute_combo, '{}'::jsonb)) AS kv(k, v)
   WHERE v = OLD.id::text;

  IF v_count > 0 THEN
    RAISE EXCEPTION
      'Cannot delete attribute_value %: still referenced by % product_variant(s) (e.g. %). Remove the value from variants first.',
      OLD.id, v_count, v_sample
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.validate_attribute_value_not_in_use()
IS 'Refuses attribute_values deletion when any product_variants.attribute_combo entry still references the row''s UUID. Mirrors validate_attribute_combo for the delete direction (the JSONB column can''t carry a real FK).';

DROP TRIGGER IF EXISTS trg_validate_attribute_value_not_in_use
  ON public.attribute_values;

CREATE TRIGGER trg_validate_attribute_value_not_in_use
  BEFORE DELETE
  ON public.attribute_values
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_attribute_value_not_in_use();
