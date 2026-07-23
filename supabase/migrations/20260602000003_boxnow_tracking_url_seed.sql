-- =============================================================================
-- Phase 11 — seed BoxNow's tracking URL template.
--
-- The Phase 0 seed left tracking_url_template NULL for BoxNow because their
-- public tracking page format wasn't confirmed. Now wired with the standard
-- consumer-facing tracking URL.
--
-- COALESCE-style update keeps any admin-customized template intact: if the
-- admin already saved a different URL via the Couriers settings page, this
-- migration won't overwrite it. Only the default-NULL case gets the seed.
-- =============================================================================

UPDATE public.delivery_carriers
SET tracking_url_template = 'https://boxnow.gr/tracking/{voucher}',
    updated_at            = now()
WHERE slug = 'box_now'
  AND tracking_url_template IS NULL;
