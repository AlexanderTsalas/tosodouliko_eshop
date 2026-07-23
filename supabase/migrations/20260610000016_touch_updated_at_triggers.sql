-- =============================================================================
-- Universal updated_at trigger — foundation for optimistic locking.
--
-- Background:
--   Server actions historically set `updated_at: new Date().toISOString()`
--   in their UPDATE payloads. This is fragile: an action that forgets
--   the field leaves the timestamp stale, which defeats optimistic
--   locking for the NEXT writer — they'd send an `expected_updated_at`
--   that matches the (unchanged) DB value, and successfully overwrite
--   a concurrent change.
--
--   For opt-locking to be a contract callers can trust, the DB MUST
--   advance `updated_at` on every UPDATE, regardless of what the app
--   put in the payload.
--
-- This migration:
--   1. Defines `public.touch_updated_at()` — a SECURITY DEFINER trigger
--      function that unconditionally sets NEW.updated_at = now() and
--      returns NEW. Idempotent: if the row already has updated_at,
--      we still overwrite (the app's value is advisory; the trigger
--      wins).
--
--   2. Dynamically attaches a BEFORE UPDATE trigger to every public
--      table that has an `updated_at` column. Skips tables that
--      already have a trigger named `*_touch_updated_at` (idempotent
--      re-runs are safe).
--
-- Why not enumerate the table list explicitly: 25+ tables in this
-- codebase have updated_at. Future tables that add the column would
-- need manual trigger setup — easy to forget. The information_schema
-- query catches every current AND future table automatically.
--
-- Effect on app code: actions that ALREADY set updated_at in their
-- payload keep working — the trigger just overwrites the value with
-- the exact same logical intent (now()). Actions that forgot to set
-- it now get correct behavior for free.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.touch_updated_at() IS
'BEFORE UPDATE trigger function: unconditionally advances updated_at to now(). Foundation for optimistic locking — actions trust this column to detect concurrent edits.';

-- Apply to every public table that has an updated_at column. Skips
-- tables where a trigger by the same name already exists (so this
-- migration is safe to re-run during development).
DO $$
DECLARE
  v_table_name text;
  v_trigger_name text;
BEGIN
  FOR v_table_name IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'updated_at'
    ORDER BY table_name
  LOOP
    v_trigger_name := v_table_name || '_touch_updated_at';

    -- Drop + recreate so re-runs pick up function changes without
    -- needing a manual DROP TRIGGER first.
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON public.%I',
      v_trigger_name, v_table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
      v_trigger_name, v_table_name
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
