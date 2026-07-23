-- =============================================================================
-- user_profiles
--
-- Supplementary table referenced by the architecture (Tables/user_profiles,
-- idx_user_profiles_email, on_user_profile_created trigger, on_auth_user_created
-- trigger / handle_new_user function) but not given an explicit Phase 1 ticket
-- in the spec. Created here as a foundational table for downstream features.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  first_name text,
  last_name text,
  phone text,
  avatar_url text,
  preferred_locale text NOT NULL DEFAULT 'el',
  preferred_currency text NOT NULL DEFAULT 'EUR',
  marketing_opt_in boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_email
  ON public.user_profiles(email);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_profiles_select_own"
  ON public.user_profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "user_profiles_update_own"
  ON public.user_profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Inserts come from the handle_new_user trigger (service role).
CREATE POLICY "user_profiles_admin_all"
  ON public.user_profiles FOR ALL
  TO authenticated
  USING (public.has_permission('manage:users'))
  WITH CHECK (public.has_permission('manage:users'));
