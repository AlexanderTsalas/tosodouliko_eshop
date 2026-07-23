-- =============================================================================
-- Drop the seeded 'other' built-in carrier — superseded by Phase 9's
-- custom-carrier admin UI. With "+ Νέα custom μεταφορική" merchants can
-- create properly named non-integrated carriers (e.g. "Δικιά μας παράδοση"),
-- which is clearer at checkout than a generic "Άλλο" catch-all.
--
-- Safe to delete only when no orders reference this carrier (FK from
-- orders.carrier_slug is ON DELETE RESTRICT). After the test-data cleanup
-- migration this is the case. The DELETE is guarded with a row-count check
-- so a future re-run on a populated database fails loudly instead of
-- silently leaving the row behind.
--
-- Note: the storefront CARRIER enum in src/config/storefront.ts and the
-- legacy orders.carrier column's check constraint still recognise 'other'
-- as a valid value. Leaving those in place is harmless — they're checks,
-- not seeds; no row will be created with carrier='other' once the UI
-- doesn't surface it. A future cleanup phase can prune the enum entirely.
-- =============================================================================

DO $$
DECLARE
  v_ref_count integer;
  v_deleted   integer;
BEGIN
  SELECT count(*) INTO v_ref_count
    FROM public.orders
   WHERE carrier_slug = 'other';
  IF v_ref_count > 0 THEN
    RAISE EXCEPTION
      'Cannot drop delivery_carriers.slug=other: % orders still reference it. Deactivate (is_active=false) instead.',
      v_ref_count
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  WITH d AS (
    DELETE FROM public.delivery_carriers WHERE slug = 'other' RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM d;
  RAISE NOTICE 'Removed delivery_carriers row: other (% row deleted)', v_deleted;
END $$;
