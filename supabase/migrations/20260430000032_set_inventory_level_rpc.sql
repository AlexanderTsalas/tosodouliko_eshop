-- =============================================================================
-- Admin RPC: set inventory levels directly.
--
-- Used by `/admin/inventory` to absolute-set quantity_available and
-- quantity_reserved (e.g., after a stock count). The storefront uses
-- `decrement_inventory` exclusively for atomic deductions.
--
-- SECURITY DEFINER + has_permission check so service-role-less callers can
-- still go through it under RLS.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_inventory_level(
  p_variant_id uuid,
  p_quantity_available integer,
  p_quantity_reserved integer DEFAULT NULL
)
RETURNS public.inventory_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result public.inventory_items;
BEGIN
  IF NOT public.has_permission('manage:products') THEN
    RAISE EXCEPTION 'permission denied: manage:products required'
      USING ERRCODE = '42501';
  END IF;

  IF p_quantity_available < 0 THEN
    RAISE EXCEPTION 'quantity_available must be >= 0';
  END IF;

  INSERT INTO public.inventory_items (variant_id, quantity_available, quantity_reserved, updated_at)
  VALUES (
    p_variant_id,
    p_quantity_available,
    COALESCE(p_quantity_reserved, 0),
    now()
  )
  ON CONFLICT (variant_id) DO UPDATE
    SET quantity_available = EXCLUDED.quantity_available,
        quantity_reserved = COALESCE(EXCLUDED.quantity_reserved, public.inventory_items.quantity_reserved),
        updated_at = now()
  RETURNING * INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.set_inventory_level(uuid, integer, integer)
IS 'Admin RPC. Absolute-sets inventory levels for a variant. Requires manage:products.';
