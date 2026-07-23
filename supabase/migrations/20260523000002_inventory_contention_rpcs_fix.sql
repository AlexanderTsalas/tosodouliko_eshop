-- =============================================================================
-- Fix soft-hold RPC semantics to match the existing inventory model.
--
-- The existing schema treats `quantity_available` as unencumbered free stock —
-- every claim (reserve_inventory, hold_soft, future priority hold) deducts
-- from it, and consume_reservation / consume_priority_held just clear the
-- reservation marker (the unit was already out of `available`).
--
-- Phase 1's hold_soft / release_soft / effective_available_for were written
-- against a different mental model where `available` was gross stock. That
-- caused an oversell bug: a unit could complete its full hold → promote →
-- consume lifecycle without `available` ever being decremented, leaving
-- the merchant with -1 actual stock and the row still showing the original
-- quantity. This migration realigns them with the existing model.
--
-- Net behavior after this fix:
--   hold_soft(qty):           available -= qty, soft_held += qty
--   release_soft(qty):        available += qty, soft_held -= qty
--   promote_soft_to_reserved: soft_held -= qty, reserved += qty (available unchanged — bucket swap)
--   effective_available_for:  returns quantity_available directly
-- =============================================================================

CREATE OR REPLACE FUNCTION public.hold_soft(p_variant_id uuid, p_qty integer)
RETURNS public.inventory_items
LANGUAGE plpgsql
AS $$
DECLARE
  result public.inventory_items;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;

  -- Deduct from available, add to soft_held — same pattern as reserve_inventory.
  UPDATE public.inventory_items
  SET quantity_available = quantity_available - p_qty,
      quantity_soft_held = quantity_soft_held + p_qty,
      updated_at         = now()
  WHERE variant_id = p_variant_id
    AND quantity_available >= p_qty
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_INVENTORY';
  END IF;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.hold_soft IS
  'Atomically moves p_qty units from available to soft_held. Same single-row-UPDATE atomic pattern as reserve_inventory. Used at "Ολοκλήρωση παραγγελίας" click to engage Phase 2 soft contention. Raises INSUFFICIENT_INVENTORY if quantity_available < p_qty.';

CREATE OR REPLACE FUNCTION public.release_soft(p_variant_id uuid, p_qty integer)
RETURNS public.inventory_items
LANGUAGE plpgsql
AS $$
DECLARE
  result public.inventory_items;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;

  -- Inverse of hold_soft: soft_held back into available.
  UPDATE public.inventory_items
  SET quantity_available = quantity_available + p_qty,
      quantity_soft_held = quantity_soft_held - p_qty,
      updated_at         = now()
  WHERE variant_id = p_variant_id
    AND quantity_soft_held >= p_qty
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_SOFT_HELD';
  END IF;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.release_soft IS
  'Atomically moves p_qty units from soft_held back to available. Used when the customer backs out of checkout, the 15-min wall-clock expires, or any soft-hold failure path. Raises INSUFFICIENT_SOFT_HELD if quantity_soft_held < p_qty.';

-- promote_soft_to_reserved is unchanged conceptually: it moves units between
-- two "claimed" buckets without touching available. Re-stated here so the
-- migration is self-contained and the original definition stays the same.
CREATE OR REPLACE FUNCTION public.promote_soft_to_reserved(p_variant_id uuid, p_qty integer)
RETURNS public.inventory_items
LANGUAGE plpgsql
AS $$
DECLARE
  result public.inventory_items;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;

  UPDATE public.inventory_items
  SET quantity_soft_held = quantity_soft_held - p_qty,
      quantity_reserved  = quantity_reserved  + p_qty,
      updated_at         = now()
  WHERE variant_id = p_variant_id
    AND quantity_soft_held >= p_qty
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_SOFT_HELD';
  END IF;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.promote_soft_to_reserved IS
  'Atomically moves p_qty units from soft_held to reserved. No change to available — the unit was already out of available when soft-held. Called when the customer commits to payment at the checkout form submit.';

-- effective_available_for now just returns quantity_available directly,
-- since `available` is already net of all hold buckets under the corrected
-- semantic. The viewer parameter is retained for the Phase 4 multi-tab
-- self-contention subtraction (still TODO).
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
  SELECT GREATEST(quantity_available, 0)
  INTO v_result
  FROM public.inventory_items
  WHERE variant_id = p_variant_id;

  -- TODO Phase 4: add back the viewer's own hold contributions so a
  -- customer who is the one holding the units doesn't see "out of stock"
  -- on their own product page in a second tab.

  RETURN COALESCE(v_result, 0);
END;
$$;

COMMENT ON FUNCTION public.effective_available_for IS
  'Per-viewer effective availability. quantity_available is already net of all hold buckets (reserved + soft_held + priority_held) under the canonical schema model, so this just returns it directly. Viewer parameter retained for Phase 4 self-contention subtraction.';
