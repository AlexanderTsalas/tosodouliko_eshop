-- =============================================================================
-- Soft-hold RPCs for the inventory contention design.
--
-- Phase 2 of the implementation plan uses these to track customers who have
-- clicked "Proceed to Checkout" but haven't yet started the Stripe Checkout
-- Session. The hold is released when the customer either advances to Stripe
-- (promote_soft_to_reserved) or backs out / times out (release_soft).
--
-- Same atomic-UPDATE-with-predicate pattern as reserve_inventory et al.
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

  -- Effective available must accommodate the request after subtracting all
  -- existing holds. The predicate is the foundation of race-free contention.
  UPDATE public.inventory_items
  SET quantity_soft_held = quantity_soft_held + p_qty,
      updated_at         = now()
  WHERE variant_id = p_variant_id
    AND (
      quantity_available
        - quantity_reserved
        - quantity_soft_held
        - quantity_priority_held
    ) >= p_qty
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_INVENTORY';
  END IF;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.hold_soft IS
  'Atomically increments quantity_soft_held by p_qty if effective availability allows. Raises INSUFFICIENT_INVENTORY otherwise. Companion to release_soft and promote_soft_to_reserved.';

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

  UPDATE public.inventory_items
  SET quantity_soft_held = quantity_soft_held - p_qty,
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
  'Atomically decrements quantity_soft_held by p_qty. Used when the customer backs out of checkout, the 15-min wall-clock expires, or the soft hold is promoted to a reservation. Raises INSUFFICIENT_SOFT_HELD if quantity_soft_held < p_qty.';

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

  -- Atomic swap: soft → reserved. No effective-availability check needed
  -- because the hold already came from effective availability.
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
  'Atomically moves p_qty units from soft_held to reserved. Called when a customer in Phase 2 (on checkout page) clicks Pay and starts a Stripe Checkout Session.';
