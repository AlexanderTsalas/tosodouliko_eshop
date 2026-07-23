-- =============================================================================
-- wf-014 — Inventory sync schema
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL UNIQUE REFERENCES public.product_variants(id) ON DELETE CASCADE,
  quantity_available integer NOT NULL DEFAULT 0,
  quantity_reserved integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (quantity_available >= 0),
  CHECK (quantity_reserved >= 0)
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_variant_id
  ON public.inventory_items(variant_id);

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_items_select_public"
  ON public.inventory_items FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY "inventory_items_admin_write"
  ON public.inventory_items FOR ALL TO authenticated
  USING (public.has_permission('manage:products'))
  WITH CHECK (public.has_permission('manage:products'));

-- Atomic decrement RPC — must be used by application code, never raw UPDATE.
CREATE OR REPLACE FUNCTION public.decrement_inventory(p_variant_id uuid, p_qty integer)
RETURNS public.inventory_items
LANGUAGE plpgsql
AS $$
DECLARE
  result public.inventory_items;
BEGIN
  UPDATE public.inventory_items
  SET quantity_available = quantity_available - p_qty,
      updated_at = now()
  WHERE variant_id = p_variant_id
    AND quantity_available >= p_qty
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_INVENTORY';
  END IF;

  RETURN result;
END;
$$;
