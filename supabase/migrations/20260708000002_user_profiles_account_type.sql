-- =============================================================================
-- Coarse identity boundary: account_type ('customer' | 'internal').
--
-- Distinguishes storefront shoppers ('customer') from back-office / internal
-- users ('internal'). This is INTENTIONALLY independent of RBAC roles: roles
-- grant fine-grained capability, account_type is a hard, provisioning-gated
-- line. `has_permission` is extended to require account_type='internal', so a
-- stray or malicious user_roles row can no longer cross into the back office
-- on its own — an attacker would ALSO have to flip account_type, which is
-- itself gated by manage:users. Two independent facts must hold, not one.
--
-- Enforcement design:
--   * Column lives on user_profiles (the 1:1 mirror of auth.users that every
--     identity gets via the handle_new_user trigger). Default 'customer', so
--     self-signup and anonymous sessions can NEVER mint 'internal'.
--   * has_permission() short-circuits to false unless the caller is internal.
--     This propagates the boundary to every RLS policy + app checkPermission
--     call for free.
--   * A BEFORE UPDATE guard blocks self-promotion: user_profiles_update_own
--     lets a user edit their own row (row-scoped, not column-scoped), so
--     without this guard a customer could `SET account_type='internal'`.
--
-- Ordering matters: the backfill runs BEFORE has_permission is rewritten, so
-- existing admins are marked 'internal' first and never lose access.
-- =============================================================================

-- 1. Enum (idempotent, matches customer_source / order_source house style) ----
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_type') THEN
    CREATE TYPE public.account_type AS ENUM ('customer', 'internal');
  END IF;
END $$;

-- 2. Column (default keeps new + existing rows as 'customer') -----------------
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS account_type public.account_type NOT NULL DEFAULT 'customer';

COMMENT ON COLUMN public.user_profiles.account_type IS
'Coarse identity: customer (shopper) vs internal (back-office). Read by has_permission as a hard precondition for any privileged action. Only settable by users with manage:users or the service role (enforced by trg_guard_user_profiles_account_type).';

-- 3. Backfill: mark existing holders of a non-customer role as internal.
--    Runs BEFORE the has_permission rewrite below so no admin is locked out.
UPDATE public.user_profiles up
SET account_type = 'internal'
WHERE up.account_type <> 'internal'
  AND EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = up.id
      AND r.name <> 'customer'
  );

-- 4. Self-promotion guard. RLS cannot restrict a single column, so a trigger
--    blocks any change to account_type from an ordinary authenticated caller.
--    The `auth.uid() IS NOT NULL` clause lets the trusted, RLS-bypassing
--    service role (used by the admin provisioning actions) through, while a
--    customer editing their own profile via the user client is rejected. An
--    unauthenticated client can't reach an UPDATE on user_profiles at all, so
--    allowing the NULL-uid path is safe.
CREATE OR REPLACE FUNCTION public.guard_user_profiles_account_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.account_type IS DISTINCT FROM OLD.account_type
     AND auth.uid() IS NOT NULL
     AND NOT public.has_permission('manage:users') THEN
    RAISE EXCEPTION 'account_type may only be changed by users with manage:users'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_user_profiles_account_type ON public.user_profiles;
CREATE TRIGGER trg_guard_user_profiles_account_type
  BEFORE UPDATE OF account_type ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_profiles_account_type();

-- 5. Extend has_permission: privileged access now requires BOTH internal
--    identity AND a role granting the permission. Signature unchanged, so all
--    ~227 RLS policies and ~279 app call sites inherit the boundary for free.
CREATE OR REPLACE FUNCTION public.has_permission(perm text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.account_type = 'internal'
    )
    AND EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = auth.uid()
        AND p.name = perm
    );
$$;

-- 6. Coarse identity check for the app-side requireInternal()/isInternalUser()
--    gate. SECURITY DEFINER so it reads account_type past the SELECT RLS.
CREATE OR REPLACE FUNCTION public.is_internal_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.account_type = 'internal'
  );
$$;

-- 7. Bootstrap path: granting a non-customer role by email must also mark the
--    user internal. This is the chicken-and-egg entry point (the FIRST admin
--    is created here, before any internal user exists), so without this the
--    bootstrapped admin would stay 'customer' and be locked out by the new
--    has_permission. Runs SECURITY DEFINER, so it bypasses the guard trigger.
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

  -- A non-customer role makes this an internal (back-office) user.
  IF p_role_name <> 'customer' THEN
    UPDATE public.user_profiles
    SET account_type = 'internal'
    WHERE id = v_user_id;
  END IF;

  RETURN v_user_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
