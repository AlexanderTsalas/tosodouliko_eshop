-- =============================================================================
-- Phase 6 — Wishlist notification dispatcher foundation.
--
-- Two tables:
--
-- notification_settings
--   Single-row store for merchant-level notification mode. The dispatcher
--   reads `wishlist_notification_mode` to decide whether to fire emails
--   directly (automated) or enqueue rows for admin review (manual).
--   Default: 'automated' for Phase 6 ship — the spec calls for 'manual' as
--   the long-term default but that requires the Phase 7 admin UI to be
--   useful. The setting will flip when Phase 7 lands.
--
-- pending_wishlist_notifications
--   Created by the dispatcher when mode='manual'. The Phase 7 admin UI
--   reads these for the wishlist queue page. For Phase 6 the table exists
--   but is only populated if an admin explicitly switches mode — without
--   the admin UI to act on them, manual mode is effectively a no-op.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- notification_settings (single-row, admin-managed)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_settings (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wishlist_notification_mode  text NOT NULL DEFAULT 'automated'
                                CHECK (wishlist_notification_mode IN ('automated', 'manual')),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Seed exactly one row. The dispatcher always reads the most-recently-updated
-- row so multiple rows aren't a correctness problem, but a single row is the
-- intended shape.
INSERT INTO public.notification_settings (wishlist_notification_mode)
SELECT 'automated'
WHERE NOT EXISTS (SELECT 1 FROM public.notification_settings);

ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_settings_admin_read"
  ON public.notification_settings FOR SELECT TO authenticated
  USING (public.has_permission('manage:orders'));

CREATE POLICY "notification_settings_admin_write"
  ON public.notification_settings FOR UPDATE TO authenticated
  USING (public.has_permission('manage:orders'));

COMMENT ON TABLE public.notification_settings IS
  'Merchant-level notification preferences. Single row in practice; the dispatcher reads the most recent.';

-- ---------------------------------------------------------------------------
-- pending_wishlist_notifications (admin queue for manual mode — Phase 7)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pending_wishlist_notifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wishlist_item_id    uuid NOT NULL REFERENCES public.wishlist_items(id) ON DELETE CASCADE,
  variant_id          uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  customer_id         uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  quantity_to_offer   integer NOT NULL CHECK (quantity_to_offer > 0),
  triggered_by        text NOT NULL
                        CHECK (triggered_by IN (
                          'stripe_abandon',
                          'cod_cancel',
                          'supply_receipt',
                          'admin_topup',
                          'priority_hold_expired'
                        )),
  triggered_at        timestamptz NOT NULL DEFAULT now(),
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'notified', 'skipped', 'expired')),
  admin_action_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_action_at     timestamptz,
  admin_message       text
);

CREATE INDEX IF NOT EXISTS idx_pending_wishlist_notifications_pending_variant
  ON public.pending_wishlist_notifications(variant_id, triggered_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pending_wishlist_notifications_customer
  ON public.pending_wishlist_notifications(customer_id, triggered_at);

ALTER TABLE public.pending_wishlist_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pending_wishlist_notifications_admin_read"
  ON public.pending_wishlist_notifications FOR SELECT TO authenticated
  USING (public.has_permission('manage:orders'));

CREATE POLICY "pending_wishlist_notifications_admin_write"
  ON public.pending_wishlist_notifications FOR UPDATE TO authenticated
  USING (public.has_permission('manage:orders'));

COMMENT ON TABLE public.pending_wishlist_notifications IS
  'Admin-review queue for wishlist notifications when notification_settings.wishlist_notification_mode = manual. Phase 7 admin UI processes these.';
