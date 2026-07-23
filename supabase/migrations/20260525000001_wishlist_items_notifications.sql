-- =============================================================================
-- Extend wishlist_items with per-item notification preferences.
--
-- The existing wishlist_items table is a basic favourites list — adding flags
-- here lets a single wishlist entry double as a back-in-stock subscription
-- (the "wishlist as registry of interest with per-item preferences" model
-- from docs/features/inventory-contention-and-notifications.md §8).
--
-- New columns:
--   quantity              — how many units the customer wants (default 1)
--   notify_on_restock     — one-shot alert when the item becomes available
--   notify_on_sale        — recurring alert when the item goes on sale
--   source                — where the entry was created ('product_page',
--                           'contention_modal', 'sold_out_page')
--   last_notified_at      — when the most recent notification fired
--   last_notification_kind — which notification fired most recently
-- =============================================================================

ALTER TABLE public.wishlist_items
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS notify_on_restock boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_on_sale boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'product_page',
  ADD COLUMN IF NOT EXISTS last_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_notification_kind text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wishlist_items_source_check'
      AND conrelid = 'public.wishlist_items'::regclass
  ) THEN
    ALTER TABLE public.wishlist_items
      ADD CONSTRAINT wishlist_items_source_check
      CHECK (source IN ('product_page', 'contention_modal', 'sold_out_page'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wishlist_items_quantity_positive'
      AND conrelid = 'public.wishlist_items'::regclass
  ) THEN
    ALTER TABLE public.wishlist_items
      ADD CONSTRAINT wishlist_items_quantity_positive
      CHECK (quantity > 0);
  END IF;
END $$;

-- Index used by the Phase 6 notification dispatcher to find subscribers when
-- inventory becomes available again.
CREATE INDEX IF NOT EXISTS idx_wishlist_items_variant_notify_restock
  ON public.wishlist_items(variant_id)
  WHERE notify_on_restock = true;

COMMENT ON COLUMN public.wishlist_items.notify_on_restock IS
  'When true, the customer should receive a one-shot notification when the variant becomes available. Flag auto-clears after the notification fires (one-shot semantic). Customer can re-enable from their wishlist.';
COMMENT ON COLUMN public.wishlist_items.notify_on_sale IS
  'When true, the customer should receive a notification every time this variant goes on sale (recurring). Customer disables manually.';
COMMENT ON COLUMN public.wishlist_items.source IS
  'Where the wishlist entry was created: product_page (manual save), contention_modal (lost a contention race), sold_out_page (notify-when-back-in-stock CTA).';
