-- =============================================================================
-- Per-variant low-stock threshold + last-variant deletion guard.
--
-- Adopts the "every product has at least one variant" model. The application
-- is responsible for creating the default variant atomically with each new
-- product (see src/actions/products/createProduct.ts), so no DB-level
-- auto-create trigger is added — admins always supply a meaningful SKU.
--
-- This migration adds two safety measures:
--   1. `low_stock_threshold` per inventory_items row, so each variant can
--      define its own restock cadence.
--   2. A BEFORE DELETE trigger on product_variants that refuses to delete
--      the last remaining variant of a product, preserving the invariant.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Per-variant low-stock threshold.
-- ---------------------------------------------------------------------------
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS low_stock_threshold integer NOT NULL DEFAULT 0
  CHECK (low_stock_threshold >= 0);

COMMENT ON COLUMN public.inventory_items.low_stock_threshold
IS 'Quantity at or below which the variant is considered low-stock (UI hint). 0 = never flag.';

-- ---------------------------------------------------------------------------
-- Prevent deletion of the last variant of a product.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_last_variant_deletion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  remaining integer;
BEGIN
  SELECT count(*) INTO remaining
  FROM public.product_variants
  WHERE product_id = OLD.product_id
    AND id <> OLD.id;

  IF remaining = 0 THEN
    RAISE EXCEPTION 'Cannot delete the last variant of a product. Delete the product instead.'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_variant_delete_check_last ON public.product_variants;
CREATE TRIGGER on_variant_delete_check_last
  BEFORE DELETE ON public.product_variants
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_last_variant_deletion();

-- ---------------------------------------------------------------------------
-- Update set_inventory_level RPC to also accept the threshold.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_inventory_level(
  p_variant_id uuid,
  p_quantity_available integer,
  p_quantity_reserved integer DEFAULT NULL,
  p_low_stock_threshold integer DEFAULT NULL
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

  IF p_low_stock_threshold IS NOT NULL AND p_low_stock_threshold < 0 THEN
    RAISE EXCEPTION 'low_stock_threshold must be >= 0';
  END IF;

  INSERT INTO public.inventory_items (
    variant_id, quantity_available, quantity_reserved, low_stock_threshold, updated_at
  )
  VALUES (
    p_variant_id,
    p_quantity_available,
    COALESCE(p_quantity_reserved, 0),
    COALESCE(p_low_stock_threshold, 0),
    now()
  )
  ON CONFLICT (variant_id) DO UPDATE
    SET quantity_available = EXCLUDED.quantity_available,
        quantity_reserved = COALESCE(EXCLUDED.quantity_reserved, public.inventory_items.quantity_reserved),
        low_stock_threshold = COALESCE(EXCLUDED.low_stock_threshold, public.inventory_items.low_stock_threshold),
        updated_at = now()
  RETURNING * INTO result;

  RETURN result;
END;
$$;
