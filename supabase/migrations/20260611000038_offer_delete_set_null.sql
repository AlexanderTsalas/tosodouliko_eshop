-- =============================================================================
-- Allow hard-delete of offers.
--
-- The legacy FK was ON DELETE RESTRICT on order_rule_applications.offer_id
-- because we initially planned soft-delete only via offers.active=false.
-- The new UX requires real deletion (the offer goes away; rules become
-- standalone). Audit rows from past orders KEEP their rule_id (which
-- still exists) but their offer_id flips to NULL.
-- =============================================================================

ALTER TABLE public.order_rule_applications
  DROP CONSTRAINT IF EXISTS order_offer_applications_offer_id_fkey;

-- The rename in migration 31 preserved the old constraint name. Use
-- IF EXISTS on both possible names to be safe.
ALTER TABLE public.order_rule_applications
  DROP CONSTRAINT IF EXISTS order_rule_applications_offer_id_fkey;

ALTER TABLE public.order_rule_applications
  ADD CONSTRAINT order_rule_applications_offer_id_fkey
  FOREIGN KEY (offer_id) REFERENCES public.offers(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
