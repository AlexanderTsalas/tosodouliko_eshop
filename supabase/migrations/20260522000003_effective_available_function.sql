-- =============================================================================
-- effective_available_for(variant_id, viewer_id)
--
-- Returns the number of units the named viewer can actually add to their
-- cart right now, accounting for global holds and (eventually) the viewer's
-- own contribution to those holds.
--
-- Phase 1 implementation: returns the global effective availability
-- (quantity_available - reserved - soft_held - priority_held) without per-
-- viewer subtraction. The multi-tab self-contention edge case (where the
-- viewer's own holds shouldn't reduce their visible availability) is
-- addressed when Phase 4's per-customer reservation tracking lands and
-- there's data to subtract.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.effective_available_for(
  p_variant_id uuid,
  p_viewer_id  uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_result integer;
BEGIN
  SELECT GREATEST(
    quantity_available
      - quantity_reserved
      - quantity_soft_held
      - quantity_priority_held,
    0
  )
  INTO v_result
  FROM public.inventory_items
  WHERE variant_id = p_variant_id;

  -- TODO Phase 4: subtract holds owned by p_viewer_id so a customer who is
  -- the one holding the units doesn't see "out of stock" on their own product
  -- page. Requires the per-session linkage tables that ship in Phase 2-4.

  RETURN COALESCE(v_result, 0);
END;
$$;

COMMENT ON FUNCTION public.effective_available_for IS
  'Per-viewer effective availability for a variant. Phase 1 returns the global figure; the viewer parameter is accepted but currently ignored. Phase 4 will subtract the viewer''s own hold contributions for the multi-tab self-contention edge case.';
