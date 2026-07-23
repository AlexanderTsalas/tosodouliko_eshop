-- =============================================================================
-- Phase 9 — Anonymous Supabase auth support.
--
-- Supabase anonymous sign-ins create an auth.users row with is_anonymous=true
-- and email=NULL. The existing trigger chain (handle_new_user →
-- user_profiles → sync_customer_from_profile → customers) breaks at the
-- user_profiles step because email was declared NOT NULL. This migration:
--
--   1. Drops the user_profiles.email NOT NULL constraint and replaces the
--      UNIQUE email index with a partial unique index that ignores NULLs.
--   2. Rewrites handle_new_user to insert user_profiles with a NULL email
--      for anonymous users (and skip user_roles assignment — anonymous
--      users get the same default 'customer' role; we still want it).
--   3. Adds a new trigger on auth.users that fires when an anonymous user
--      upgrades (gains an email via auth.updateUser or linkIdentity) —
--      syncs the new email back to user_profiles, which cascades to
--      customers via the existing sync_customer_from_profile trigger.
--
-- Existing rows: none have NULL email, so the column relaxation is safe.
-- The UNIQUE index becomes partial-on-non-null, preserving uniqueness for
-- real emails while allowing many NULL-email anonymous profiles to coexist.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Relax user_profiles.email constraint
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_profiles
  ALTER COLUMN email DROP NOT NULL;

-- Replace the non-partial unique index with a partial one. Old name kept
-- so existing references / tooling continue to work.
DROP INDEX IF EXISTS public.idx_user_profiles_email;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_email
  ON public.user_profiles(email)
  WHERE email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Rewrite handle_new_user — pass through NULL email for anonymous users
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, first_name, last_name)
  VALUES (
    NEW.id,
    -- NEW.email is NULL for anonymous users; allow it through.
    NEW.email,
    NEW.raw_user_meta_data ->> 'first_name',
    NEW.raw_user_meta_data ->> 'last_name'
  )
  ON CONFLICT (id) DO NOTHING;

  -- Anonymous users still need the customer role so RLS policies work.
  INSERT INTO public.user_roles (user_id, role_id)
  SELECT NEW.id, r.id
  FROM public.roles r
  WHERE r.name = 'customer'
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Anonymous → permanent upgrade trigger
--
-- When an anonymous user gains an email (auth.updateUser or linkIdentity),
-- copy the email into user_profiles. The existing
-- sync_customer_from_profile UPDATE trigger picks up the user_profiles
-- change and cascades it to customers automatically.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_user_profile_on_auth_email_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only act when email transitions from NULL → non-NULL (the anonymous
  -- → permanent upgrade signal) or when an existing email changes.
  IF NEW.email IS DISTINCT FROM OLD.email AND NEW.email IS NOT NULL THEN
    UPDATE public.user_profiles
    SET email      = NEW.email,
        updated_at = now()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;
CREATE TRIGGER on_auth_user_email_changed
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_profile_on_auth_email_change();

COMMENT ON FUNCTION public.sync_user_profile_on_auth_email_change IS
  'Propagates auth.users.email changes to user_profiles.email. Primary driver: anonymous-user upgrade via auth.updateUser({ email }) or linkIdentity. The existing sync_customer_from_profile trigger then cascades the change to customers.';
