-- =============================================================================
-- Phase 0 of courier-integration-design.md — Carrier model as data
--
-- Add orders.carrier_slug as a text FK into delivery_carriers. The existing
-- orders.carrier enum column stays for backward compatibility during the
-- transition; app code writes BOTH columns during this phase, reads can use
-- either. A later migration (post-Phase 0, once every read site has moved to
-- carrier_slug) drops the enum column.
--
-- Why additive: existing checkout / order pages reference orders.carrier
-- across many surfaces. Dropping it now would force a coordinated rewrite of
-- every read site in the same PR, which is risky. Keeping both columns during
-- Phase 0 lets us migrate readers incrementally.
--
-- The enum-only orders.carrier cannot store custom carrier slugs ('custom_*'),
-- so once custom carriers ship (Phase 9), orders using them MUST have
-- carrier_slug populated and may have carrier=NULL — at that point reads on
-- the enum column are guaranteed to be incomplete and the column becomes
-- vestigial.
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS carrier_slug text REFERENCES public.delivery_carriers(slug) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_orders_carrier_slug
  ON public.orders(carrier_slug);

-- ---------------------------------------------------------------------------
-- Backfill: copy existing enum values into the new text column. The enum
-- slugs match delivery_carriers.slug exactly (acs, elta, box_now, speedex,
-- geniki, other), so a direct cast works. Skip rows that already have
-- carrier_slug set (idempotent re-run).
-- ---------------------------------------------------------------------------

UPDATE public.orders
SET carrier_slug = carrier::text
WHERE carrier IS NOT NULL
  AND carrier_slug IS NULL;

-- ---------------------------------------------------------------------------
-- Extend the store_pickup constraint to cover both columns. After the
-- backfill, every row with carrier IS NOT NULL also has carrier_slug
-- IS NOT NULL, so the original constraint stays valid; we add a sibling on
-- carrier_slug so that new writes that only set the slug still get checked.
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_carrier_slug_not_for_pickup;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_carrier_slug_not_for_pickup
  CHECK (delivery_method != 'store_pickup' OR carrier_slug IS NULL);

COMMENT ON COLUMN public.orders.carrier_slug IS
  'Foreign key into delivery_carriers(slug). Supersedes orders.carrier (enum), which stays during the Phase 0 transition. Custom carriers can only populate this column; orders.carrier is enum-bound and cannot hold custom slugs.';
