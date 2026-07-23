-- =============================================================================
-- Phase 4D — Add inventory_items to the realtime publication so the product
-- page can subscribe to availability changes and live-flip its CTA between
-- "Add to Cart" and "Notify me when available."
--
-- inventory_items already has a public-read RLS policy
-- (inventory_items_select_public, established in 20260430000014), so Realtime
-- will deliver change events to any subscribed client without further policy
-- work.
-- =============================================================================

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_items;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
