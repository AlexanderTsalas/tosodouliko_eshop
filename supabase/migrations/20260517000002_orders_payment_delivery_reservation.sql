-- =============================================================================
-- Orders: split payment vs fulfillment, add payment_method / delivery_method /
-- carrier / source, support guest orders, and add inventory reservation
-- primitives for non-prepaid order types (COD, store pickup, bank transfer).
--
-- Background — three orthogonal axes on every order:
--   * payment_method     : how the customer pays (stripe / cod / cash_on_pickup / bank_transfer)
--   * delivery_method    : how they receive (home_delivery / store_pickup / delivery_station_pickup)
--   * source             : where the order was created (eshop / phone / in_store; integrations later)
--
-- The current single `status` column conflates "did we get paid" with "where is
-- the order in the fulfillment pipeline" — fine for Stripe-only, breaks for COD
-- where an order can be `shipped` while still unpaid. We split it into:
--   * payment_status     : pending / paid / refunded / failed
--   * fulfillment_status : draft / pending / confirmed / preparing /
--                          shipped / ready_for_pickup / delivered / picked_up / cancelled
--
-- Inventory rule (enforced in application code, primitives provided here):
--   * Stripe-paid orders          -> decrement_inventory directly on payment success
--   * COD / cash / bank transfer  -> reserve_inventory at confirmation, consume on
--                                    delivered+paid, release on cancel
--
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_payment_method') THEN
    CREATE TYPE public.order_payment_method
      AS ENUM ('stripe', 'cod', 'cash_on_pickup', 'bank_transfer');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_delivery_method') THEN
    CREATE TYPE public.order_delivery_method
      AS ENUM ('home_delivery', 'store_pickup', 'delivery_station_pickup');
  END IF;
END $$;

-- Carriers — adding more later is a one-line ALTER TYPE ADD VALUE.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_carrier') THEN
    CREATE TYPE public.order_carrier
      AS ENUM ('acs', 'elta', 'box_now', 'speedex', 'geniki', 'other');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_source') THEN
    CREATE TYPE public.order_source
      AS ENUM ('eshop', 'phone', 'in_store');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_payment_status') THEN
    CREATE TYPE public.order_payment_status
      AS ENUM ('pending', 'paid', 'refunded', 'failed');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_fulfillment_status') THEN
    CREATE TYPE public.order_fulfillment_status
      AS ENUM (
        'draft',
        'pending',
        'confirmed',
        'preparing',
        'shipped',
        'ready_for_pickup',
        'delivered',
        'picked_up',
        'cancelled'
      );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- orders — additive changes first, then backfill, then constraints, then drop
-- the old `status` column (and its CHECK constraint disappears with it).
-- -----------------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_method     public.order_payment_method,
  ADD COLUMN IF NOT EXISTS delivery_method    public.order_delivery_method,
  ADD COLUMN IF NOT EXISTS carrier            public.order_carrier,
  ADD COLUMN IF NOT EXISTS source             public.order_source,
  ADD COLUMN IF NOT EXISTS payment_status     public.order_payment_status,
  ADD COLUMN IF NOT EXISTS fulfillment_status public.order_fulfillment_status,
  ADD COLUMN IF NOT EXISTS created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS guest_name         text,
  ADD COLUMN IF NOT EXISTS guest_email        text,
  ADD COLUMN IF NOT EXISTS guest_phone        text;

-- Backfill from old single status column. Safe on empty tables (0 rows changed).
UPDATE public.orders
SET
  payment_method  = COALESCE(payment_method,  'stripe'),
  delivery_method = COALESCE(delivery_method, 'home_delivery'),
  source          = COALESCE(source,          'eshop'),
  payment_status  = COALESCE(
    payment_status,
    CASE status
      WHEN 'refunded'  THEN 'refunded'::public.order_payment_status
      WHEN 'pending'   THEN 'pending'::public.order_payment_status
      WHEN 'cancelled' THEN 'pending'::public.order_payment_status
      ELSE                  'paid'::public.order_payment_status
    END
  ),
  fulfillment_status = COALESCE(
    fulfillment_status,
    CASE status
      WHEN 'pending'    THEN 'pending'::public.order_fulfillment_status
      WHEN 'paid'       THEN 'confirmed'::public.order_fulfillment_status
      WHEN 'fulfilling' THEN 'preparing'::public.order_fulfillment_status
      WHEN 'shipped'    THEN 'shipped'::public.order_fulfillment_status
      WHEN 'delivered'  THEN 'delivered'::public.order_fulfillment_status
      WHEN 'cancelled'  THEN 'cancelled'::public.order_fulfillment_status
      WHEN 'refunded'   THEN 'cancelled'::public.order_fulfillment_status
      ELSE                   'pending'::public.order_fulfillment_status
    END
  );

ALTER TABLE public.orders
  ALTER COLUMN payment_method     SET NOT NULL,
  ALTER COLUMN delivery_method    SET NOT NULL,
  ALTER COLUMN source             SET NOT NULL,
  ALTER COLUMN payment_status     SET NOT NULL,
  ALTER COLUMN fulfillment_status SET NOT NULL,
  ALTER COLUMN source             SET DEFAULT 'eshop',
  ALTER COLUMN payment_status     SET DEFAULT 'pending',
  ALTER COLUMN fulfillment_status SET DEFAULT 'pending';

-- Drop the old single-axis status column (its CHECK goes with it).
ALTER TABLE public.orders DROP COLUMN IF EXISTS status;

-- Old index becomes useless once the column is gone.
DROP INDEX IF EXISTS public.idx_orders_status;

-- New indexes for the three filter axes the admin list will use.
CREATE INDEX IF NOT EXISTS idx_orders_payment_status     ON public.orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_status ON public.orders(fulfillment_status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_method     ON public.orders(payment_method);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_method    ON public.orders(delivery_method);
CREATE INDEX IF NOT EXISTS idx_orders_source             ON public.orders(source);

-- -----------------------------------------------------------------------------
-- Guest support — relax user_id, require at least one of (user_id, guest_email).
-- -----------------------------------------------------------------------------

ALTER TABLE public.orders ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_user_or_guest_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_user_or_guest_check
  CHECK (user_id IS NOT NULL OR guest_email IS NOT NULL);

-- -----------------------------------------------------------------------------
-- Carrier consistency — store_pickup cannot have a carrier; other methods can
-- have NULL (admin hasn't picked yet) or any carrier value.
-- -----------------------------------------------------------------------------

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_carrier_not_for_pickup;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_carrier_not_for_pickup
  CHECK (delivery_method != 'store_pickup' OR carrier IS NULL);

-- -----------------------------------------------------------------------------
-- order_number autogeneration. Format: ORD-YYYY-NNNNNN with a global sequence.
-- Year prefix is informational only; the sequence never resets, keeping numbers
-- globally monotonic for audit and customer-support lookups.
-- -----------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.orders_number_seq
  START WITH 1 INCREMENT BY 1 MINVALUE 1 CACHE 1;

CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  seq bigint;
BEGIN
  seq := nextval('public.orders_number_seq');
  RETURN 'ORD-' || to_char(now(), 'YYYY') || '-' || lpad(seq::text, 6, '0');
END;
$$;

COMMENT ON FUNCTION public.generate_order_number IS
  'Generates a monotonic order number like ORD-2026-000042. The year segment is informational only — the sequence never resets, so the numeric portion is globally unique.';

ALTER TABLE public.orders
  ALTER COLUMN order_number SET DEFAULT public.generate_order_number();

-- -----------------------------------------------------------------------------
-- Update RLS so the admin policy includes "manage:orders" perm (already does).
-- The existing policies still work because they key off user_id/permission;
-- only the column shape changed, not who can read/write.
-- -----------------------------------------------------------------------------

-- (No RLS changes needed.)

-- -----------------------------------------------------------------------------
-- Inventory reservation RPCs. All three are atomic single-row UPDATEs that fail
-- loudly when the invariant would be violated, mirroring the existing
-- decrement_inventory pattern.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reserve_inventory(p_variant_id uuid, p_qty integer)
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
  SET quantity_available = quantity_available - p_qty,
      quantity_reserved  = quantity_reserved  + p_qty,
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

COMMENT ON FUNCTION public.reserve_inventory IS
  'Atomically moves p_qty units from available to reserved. Used at order placement for COD / cash_on_pickup / bank_transfer / store_pickup, and for any flow where the sale is not yet final from our perspective. Raises INSUFFICIENT_INVENTORY if quantity_available < p_qty.';

CREATE OR REPLACE FUNCTION public.release_reservation(p_variant_id uuid, p_qty integer)
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
  SET quantity_available = quantity_available + p_qty,
      quantity_reserved  = quantity_reserved  - p_qty,
      updated_at         = now()
  WHERE variant_id = p_variant_id
    AND quantity_reserved >= p_qty
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_RESERVED';
  END IF;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.release_reservation IS
  'Atomically moves p_qty units from reserved back to available. Used when a reserved order is cancelled before fulfillment. Raises INSUFFICIENT_RESERVED if quantity_reserved < p_qty.';

CREATE OR REPLACE FUNCTION public.consume_reservation(p_variant_id uuid, p_qty integer)
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
  SET quantity_reserved = quantity_reserved - p_qty,
      updated_at        = now()
  WHERE variant_id = p_variant_id
    AND quantity_reserved >= p_qty
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_RESERVED';
  END IF;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.consume_reservation IS
  'Atomically decrements reserved without touching available — the units physically left the warehouse. Used when a reserved order reaches a terminal fulfilled state (delivered+paid for COD, picked_up+paid for store_pickup, vendor_accepted for platform orders).';

CREATE OR REPLACE FUNCTION public.restore_inventory(p_variant_id uuid, p_qty integer)
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
  SET quantity_available = quantity_available + p_qty,
      updated_at         = now()
  WHERE variant_id = p_variant_id
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVENTORY_NOT_FOUND';
  END IF;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.restore_inventory IS
  'Inverse of decrement_inventory — adds p_qty back to quantity_available. Used when a Stripe-paid order is cancelled or refunded after inventory was already decremented (items never physically left, so we return them to the available pool).';
