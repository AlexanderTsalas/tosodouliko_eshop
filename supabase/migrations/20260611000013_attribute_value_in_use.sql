-- =============================================================================
-- Phase 9 — attribute_value_in_use existence check.
--
-- Background:
--   deleteAttributeValue.ts currently fetches EVERY product_variants row
--   that has a non-null attribute_combo + scans the resulting array in
--   JS to check whether any variant references the value being deleted.
--   At scale (~5k+ variants) this transfers the entire attribute_combo
--   jsonb column over the wire just to compute a boolean.
--
-- This RPC pushes the check into Postgres. The expression
--   jsonb_each_text(v.attribute_combo) WHERE value_id = p_value_id::text
-- short-circuits the moment one matching row is found (EXISTS).
--
-- Performance note: at the time of writing, attribute_combo has a GIN
-- index from earlier migrations (`idx_product_variants_combo_gin` in
-- the split-listing migration). The planner uses it for the unnest
-- when selectivity is high, otherwise falls back to a seq scan that's
-- still cheaper than ferrying every row to Node.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.attribute_value_in_use(p_value_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.product_variants v,
         jsonb_each_text(coalesce(v.attribute_combo, '{}'::jsonb)) AS kv(combo_slug, combo_value_id)
    WHERE v.attribute_combo IS NOT NULL
      AND kv.combo_value_id = p_value_id::text
  );
$$;

COMMENT ON FUNCTION public.attribute_value_in_use(uuid) IS
'Returns TRUE if any product_variants row references this attribute_values.id via its attribute_combo jsonb. Used by deleteAttributeValue to short-circuit deletion when the value is still in use.';

REVOKE EXECUTE ON FUNCTION public.attribute_value_in_use(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.attribute_value_in_use(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
