-- =============================================================================
-- Loosen order_items.variant_id FK to ON DELETE SET NULL.
--
-- Background:
--   Audit of variant deletion found a single inconsistency in cascade
--   policy on tables referencing product_variants(id):
--
--     inventory_items     : CASCADE  ✓ delete with variant
--     cart_items          : CASCADE  ✓ delete with variant
--     wishlist_items      : CASCADE  ✓ delete with variant
--     supplier_products   : CASCADE  ✓ delete with variant
--     soft_waits          : CASCADE  ✓ delete with variant
--     priority_holds      : CASCADE  ✓ delete with variant
--     wishlist_notifications: CASCADE ✓
--     collapse_notifications: CASCADE ✓
--     product_images      : SET NULL ✓ keep image, drop variant link
--     purchase_lots       : RESTRICT ✓ intentional — protect accounting
--                                     history (admin must reassign first)
--   → order_items         : NO ACTION ✗ ← blocks variant delete with no
--                                         signal, but order_items already
--                                         snapshot product_name +
--                                         variant_label, so the variant
--                                         row is informational once
--                                         delivered.
--
-- The right policy is SET NULL — same as product_images:
--   - The order receipt + history are self-contained (snapshots are
--     copied at order creation in placeOrder)
--   - The FK still RESTRICTs while orders are in-flight via the
--     `purchase_lots RESTRICT` chain (if you have unfulfilled supply
--     receipts you can't delete) and via the admin UI's own guards.
--   - When variant_id becomes NULL, future code reading order_items
--     can detect "variant no longer exists in catalog" without
--     orphaned-uuid joins returning empty rows silently.
-- =============================================================================

ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_variant_id_fkey;

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_variant_id_fkey
  FOREIGN KEY (variant_id)
  REFERENCES public.product_variants(id)
  ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
