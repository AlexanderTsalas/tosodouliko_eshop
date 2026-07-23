-- =============================================================================
-- Inventory contention foundation: per-variant counters for the soft and
-- priority holds defined in docs/features/inventory-contention-and-notifications.md.
--
-- Phase 1 of the implementation plan introduces the columns; the RPCs that
-- mutate them ship alongside in 20260522000002_inventory_contention_rpcs.sql.
--
-- Effective availability for a customer ready to add to cart becomes:
--   quantity_available
--     - quantity_reserved        (already-confirmed-buy reservations)
--     - quantity_soft_held       (Phase 2: customer on checkout page, pre-Stripe)
--     - quantity_priority_held   (Phase 6: 30-min wishlist promotion hold)
-- =============================================================================

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS quantity_soft_held integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quantity_priority_held integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventory_items_quantity_soft_held_nonneg'
      AND conrelid = 'public.inventory_items'::regclass
  ) THEN
    ALTER TABLE public.inventory_items
      ADD CONSTRAINT inventory_items_quantity_soft_held_nonneg
      CHECK (quantity_soft_held >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventory_items_quantity_priority_held_nonneg'
      AND conrelid = 'public.inventory_items'::regclass
  ) THEN
    ALTER TABLE public.inventory_items
      ADD CONSTRAINT inventory_items_quantity_priority_held_nonneg
      CHECK (quantity_priority_held >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.inventory_items.quantity_soft_held IS
  'Units held by customers currently on the checkout page (pre-Stripe). Populated by Phase 2 of the inventory-contention design — for Phase 1 the column exists but is always 0.';
COMMENT ON COLUMN public.inventory_items.quantity_priority_held IS
  '30-minute exclusive holds granted to wishlist notification recipients (Phase 6). For Phase 1 the column exists but is always 0.';
