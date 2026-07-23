-- =============================================================================
-- Suppliers + Supply Orders + Purchase Lots (Phase H1).
--
-- Three orthogonal axes:
--   * suppliers              who they are (contact, currency, address)
--   * supplier_products      which suppliers carry which variants (relationship)
--   * purchase_lots          physical receipts — single source of truth for cost timelines
--
-- Supply Orders is a light PO system: drafts -> placed -> received,
-- with a Cancel exit from draft/placed. Receipt creates purchase_lots
-- and increments inventory atomically.
--
-- The order_items.unit_cost_at_sale column is the COGS snapshot used by
-- per-period margin reports.  fulfillOrder() will be modified separately
-- to compute the weighted-average cost and write it at sale time.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ENUMs
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'supply_order_status') THEN
    CREATE TYPE public.supply_order_status AS ENUM ('draft', 'placed', 'received', 'cancelled');
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- suppliers
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.suppliers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  primary_email       text,
  primary_phone       text,
  default_currency    text NOT NULL DEFAULT 'EUR',
  street              text,
  city                text,
  postal_code         text,
  country_code        text, -- ISO 3166-1 alpha-2
  notes               text,
  -- Persists column-header → field mapping per supplier so subsequent
  -- receipt imports skip the mapping step. Shape: {"supplier_sku": "ItemCode", ...}
  receipt_column_map  jsonb,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_active ON public.suppliers(active);

COMMENT ON COLUMN public.suppliers.default_currency IS
  'ISO 4217 — the currency this supplier typically invoices in. Used as default for new purchase_lots.';
COMMENT ON COLUMN public.suppliers.receipt_column_map IS
  'Remembered column-header → field mapping for this supplier''s receipt CSVs. Skipped on second-and-later receipts.';

-- -----------------------------------------------------------------------------
-- supplier_products (M:N variant ↔ supplier, no cost columns)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.supplier_products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id      uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  supplier_id     uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  supplier_sku    text,
  -- Rolling estimate, updated on each receipt from (received_at - placed_at).
  lead_time_days  int,
  is_preferred    boolean NOT NULL DEFAULT false,
  notes           text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(variant_id, supplier_id)
);

-- At most one preferred supplier per variant.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sp_one_preferred_per_variant
  ON public.supplier_products(variant_id) WHERE is_preferred;

CREATE INDEX IF NOT EXISTS idx_sp_variant ON public.supplier_products(variant_id);
CREATE INDEX IF NOT EXISTS idx_sp_supplier ON public.supplier_products(supplier_id);

-- -----------------------------------------------------------------------------
-- supply_orders
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.supply_orders (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: cannot delete a supplier with order history (accounting safety).
  supplier_id              uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  status                   public.supply_order_status NOT NULL DEFAULT 'draft',
  placed_at                timestamptz,
  received_at              timestamptz,
  notes                    text,
  receipt_file_storage_key text, -- supply-order-receipts/<id>/<filename>
  created_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_so_status ON public.supply_orders(status);
CREATE INDEX IF NOT EXISTS idx_so_supplier ON public.supply_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_so_created_at ON public.supply_orders(created_at DESC);

-- -----------------------------------------------------------------------------
-- supply_order_lines
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.supply_order_lines (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supply_order_id        uuid NOT NULL REFERENCES public.supply_orders(id) ON DELETE CASCADE,
  -- RESTRICT: protect against accidentally orphaning historical PO lines.
  variant_id             uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,

  -- Snapshots taken at the moment the line was drafted (readable later even
  -- if the variant is renamed, the supplier SKU changes, threshold moves, etc.)
  business_sku_at_draft  text NOT NULL,
  supplier_sku_at_draft  text,
  variant_label          text,
  qty_at_draft           int,
  threshold_at_draft     int,

  -- Order quantities/costs (ordered_qty filled at draft; received_* at receipt).
  ordered_qty            int NOT NULL CHECK (ordered_qty > 0),
  received_qty           int,
  unit_cost              numeric(10,2),
  unit_cost_currency     text,
  received_unit_cost     numeric(10,2),

  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sol_order ON public.supply_order_lines(supply_order_id);
CREATE INDEX IF NOT EXISTS idx_sol_variant ON public.supply_order_lines(variant_id);

COMMENT ON COLUMN public.supply_order_lines.unit_cost IS
  'Expected unit cost at the time the order was placed (snapshot from latest purchase_lot or admin entry). Editable until status=placed.';
COMMENT ON COLUMN public.supply_order_lines.received_unit_cost IS
  'Actual unit cost when goods arrived. May differ from unit_cost. Drives the purchase_lots insert at receipt.';

-- -----------------------------------------------------------------------------
-- purchase_lots — physical receipts; cost timeline source of truth
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.purchase_lots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id          uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  -- SET NULL: keep historical receipt cost even if the supplier is deleted.
  supplier_id         uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  -- SET NULL: the lot persists if the parent order is hard-deleted (rare).
  supply_order_id     uuid REFERENCES public.supply_orders(id) ON DELETE SET NULL,
  received_qty        int NOT NULL CHECK (received_qty > 0),
  unit_cost           numeric(10,2) NOT NULL CHECK (unit_cost >= 0),
  unit_cost_currency  text NOT NULL,
  received_at         timestamptz NOT NULL,
  notes               text,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- The hot read path: "latest cost from supplier S for variant V"
-- and "all lots for variant V across all suppliers, newest first".
CREATE INDEX IF NOT EXISTS idx_pl_lookup
  ON public.purchase_lots(variant_id, supplier_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_pl_variant_time
  ON public.purchase_lots(variant_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_pl_order ON public.purchase_lots(supply_order_id);

-- -----------------------------------------------------------------------------
-- Modifications to existing tables
-- -----------------------------------------------------------------------------

-- Per-variant flag: when false, the variant never appears in Supply Orders
-- working lists regardless of stock state (discontinued, self-made, etc.).
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS track_supply boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.product_variants.track_supply IS
  'When false, this variant is excluded from Supply Orders auto-suggestions even when stock is low or zero.';

-- Soft default used only when creating new variants on this product (UX scaffolding).
-- Truth about which suppliers carry which variants lives in supplier_products.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS default_supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.products.default_supplier_id IS
  'UX hint only — pre-fills the supplier picker for new variants. Per-variant truth lives in supplier_products.';

-- COGS snapshot: written by fulfillOrder() at payment success, never recalculated.
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS unit_cost_at_sale          numeric(10,2),
  ADD COLUMN IF NOT EXISTS unit_cost_at_sale_currency text;

COMMENT ON COLUMN public.order_items.unit_cost_at_sale IS
  'Weighted-average cost on hand at the moment of sale fulfillment. Frozen — drives honest per-period COGS reports.';

-- -----------------------------------------------------------------------------
-- increment_inventory RPC (mirrors decrement_inventory; used on receipt)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.increment_inventory(p_variant_id uuid, p_qty int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;

  INSERT INTO public.inventory_items (variant_id, quantity_available, quantity_reserved)
  VALUES (p_variant_id, p_qty, 0)
  ON CONFLICT (variant_id) DO UPDATE
  SET quantity_available = inventory_items.quantity_available + p_qty,
      updated_at = now();
END;
$$;

COMMENT ON FUNCTION public.increment_inventory IS
  'Atomically adds p_qty to inventory_items.quantity_available for a variant. Creates the inventory_items row if missing. Used by supply-order receipt and by manual stock adjustments.';

-- -----------------------------------------------------------------------------
-- Storage bucket for receipt files
-- -----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('supply-order-receipts', 'supply-order-receipts', false)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Permission seed
-- -----------------------------------------------------------------------------

INSERT INTO public.permissions (name, resource, action, description) VALUES
  ('manage:suppliers', 'suppliers', 'manage', 'Create/edit/delete suppliers and manage supply orders')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'admin' AND p.name = 'manage:suppliers'
ON CONFLICT DO NOTHING;
