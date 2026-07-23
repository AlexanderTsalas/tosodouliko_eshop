-- =============================================================================
-- Bootstrap helpers for granting/revoking admin access by email.
--
-- Use these from psql, the Supabase SQL Editor, or the
-- `scripts/bootstrap-admin.mjs` Node script.
--
-- Examples:
--   SELECT public.grant_admin_by_email('me@example.com');
--   SELECT public.grant_role_by_email('me@example.com', 'staff');
--   SELECT public.revoke_role_by_email('me@example.com', 'admin');
-- =============================================================================

CREATE OR REPLACE FUNCTION public.grant_role_by_email(p_email text, p_role_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_role_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = p_email LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No auth.users row with email %', p_email
      USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_role_id FROM public.roles WHERE name = p_role_name LIMIT 1;
  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'No role named %', p_role_name
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.user_roles (user_id, role_id)
  VALUES (v_user_id, v_role_id)
  ON CONFLICT (user_id, role_id) DO NOTHING;

  RETURN v_user_id;
END;
$$;

COMMENT ON FUNCTION public.grant_role_by_email(text, text)
IS 'Bootstrap helper. Grants an existing role to an existing user by email. Idempotent.';

-- ---------------------------------------------------------------------------
-- Convenience wrapper: grant the seeded `admin` role.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_admin_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.grant_role_by_email(p_email, 'admin');
$$;

COMMENT ON FUNCTION public.grant_admin_by_email(text)
IS 'Bootstrap helper. Promotes a user (looked up by email) to the seeded admin role.';

-- ---------------------------------------------------------------------------
-- Inverse — useful for revoking access.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_role_by_email(p_email text, p_role_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_role_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = p_email LIMIT 1;
  SELECT id INTO v_role_id FROM public.roles WHERE name = p_role_name LIMIT 1;
  IF v_user_id IS NULL OR v_role_id IS NULL THEN
    RETURN NULL;
  END IF;

  DELETE FROM public.user_roles
  WHERE user_id = v_user_id AND role_id = v_role_id;

  RETURN v_user_id;
END;
$$;

COMMENT ON FUNCTION public.revoke_role_by_email(text, text)
IS 'Bootstrap helper. Removes a role from a user by email. No-op if either is missing.';
