-- =============================================================================
-- wf-005 — Address book schema
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text,
  first_name text NOT NULL,
  last_name text NOT NULL,
  address_line1 text NOT NULL,
  address_line2 text,
  city text NOT NULL,
  state text,
  postal_code text NOT NULL,
  country_code text NOT NULL,
  phone text,
  is_default boolean NOT NULL DEFAULT false,
  is_default_billing boolean NOT NULL DEFAULT false,
  is_default_shipping boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_addresses_user_id
  ON public.addresses(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_addresses_default_billing
  ON public.addresses(user_id) WHERE is_default_billing = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_addresses_default_shipping
  ON public.addresses(user_id) WHERE is_default_shipping = true;

ALTER TABLE public.addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "addresses_select_own"
  ON public.addresses FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "addresses_insert_own"
  ON public.addresses FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "addresses_update_own"
  ON public.addresses FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "addresses_delete_own"
  ON public.addresses FOR DELETE TO authenticated
  USING (user_id = auth.uid());
