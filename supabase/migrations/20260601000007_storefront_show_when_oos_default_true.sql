-- =============================================================================
-- Flip the storefront-wide show_when_oos default from false → true.
--
-- The original 20260531000005 seeded the singleton with false on the
-- conservative assumption that hiding OOS items was the safer pre-existing
-- behavior. The product direction is the opposite: we want OOS variants
-- visible by default so the wishlist / notify-me-when-back-in-stock flow
-- stays alive on every product unless a merchant explicitly opts out at
-- product or variant level.
--
-- Two changes:
--   1. The COLUMN DEFAULT — affects any future re-seed / fresh install.
--   2. The seeded singleton row — affects this database now. Idempotent;
--      only touches rows whose value matches the old default (false), so a
--      merchant who has already chosen `true` is unaffected and a merchant
--      who has deliberately overridden to `false` would need to do so
--      again (acceptable — there's no merchant UI for this yet, and the
--      stated intent is "show by default").
-- =============================================================================

ALTER TABLE public.storefront_settings
  ALTER COLUMN show_when_oos_default SET DEFAULT true;

UPDATE public.storefront_settings
SET show_when_oos_default = true,
    updated_at = now()
WHERE id = 1
  AND show_when_oos_default = false;
