-- =============================================================================
-- Phase 7 — Manual wishlist queue admin permission.
--
-- Adds a dedicated `manage:wishlist_queue` permission so merchants can grant
-- access to the wishlist-queue admin without granting full `manage:orders`.
-- Auto-grants it to the `admin` role for parity with other manage:* perms.
-- Updates the RLS on `pending_wishlist_notifications` (originally guarded by
-- `manage:orders` in 20260527000001) to use the new permission.
-- =============================================================================

-- Permission row + admin grant.
INSERT INTO public.permissions (name, resource, action, description) VALUES
  ('manage:wishlist_queue', 'wishlist_queue', 'manage',
   'Review and act on pending wishlist notifications (manual mode)')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.name = 'manage:wishlist_queue'
WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

-- Migrate the pending_wishlist_notifications policies to the dedicated
-- permission. Drop old + recreate with the new check.
DROP POLICY IF EXISTS "pending_wishlist_notifications_admin_read"
  ON public.pending_wishlist_notifications;
DROP POLICY IF EXISTS "pending_wishlist_notifications_admin_write"
  ON public.pending_wishlist_notifications;

CREATE POLICY "pending_wishlist_notifications_queue_read"
  ON public.pending_wishlist_notifications FOR SELECT TO authenticated
  USING (public.has_permission('manage:wishlist_queue'));

CREATE POLICY "pending_wishlist_notifications_queue_write"
  ON public.pending_wishlist_notifications FOR UPDATE TO authenticated
  USING (public.has_permission('manage:wishlist_queue'));

-- Same migration for notification_settings — admins managing the queue
-- also flip the automated/manual mode toggle.
DROP POLICY IF EXISTS "notification_settings_admin_read" ON public.notification_settings;
DROP POLICY IF EXISTS "notification_settings_admin_write" ON public.notification_settings;

CREATE POLICY "notification_settings_queue_read"
  ON public.notification_settings FOR SELECT TO authenticated
  USING (public.has_permission('manage:wishlist_queue'));

CREATE POLICY "notification_settings_queue_write"
  ON public.notification_settings FOR UPDATE TO authenticated
  USING (public.has_permission('manage:wishlist_queue'));
