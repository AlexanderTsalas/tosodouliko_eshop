-- =============================================================================
-- wf-011 — Discount engine schema
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  type text NOT NULL,
  value numeric(10,2) NOT NULL,
  usage_limit integer,
  usage_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (type IN ('percent', 'fixed', 'free_shipping')),
  CHECK (value >= 0)
);

CREATE INDEX IF NOT EXISTS idx_discount_codes_code
  ON public.discount_codes(code);
CREATE INDEX IF NOT EXISTS idx_discount_codes_active
  ON public.discount_codes(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_discount_codes_expires
  ON public.discount_codes(expires_at) WHERE expires_at IS NOT NULL;

ALTER TABLE public.discount_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "discount_codes_select_public"
  ON public.discount_codes FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY "discount_codes_admin_write"
  ON public.discount_codes FOR ALL TO authenticated
  USING (public.has_permission('manage:discounts'))
  WITH CHECK (public.has_permission('manage:discounts'));

-- ---------------------------------------------------------------------------
-- discount_usage (junction)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.discount_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discount_id uuid NOT NULL REFERENCES public.discount_codes(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  order_id uuid,
  amount_applied numeric(10,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discount_usage_discount_id
  ON public.discount_usage(discount_id);
CREATE INDEX IF NOT EXISTS idx_discount_usage_user_id
  ON public.discount_usage(user_id);

ALTER TABLE public.discount_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "discount_usage_select_own"
  ON public.discount_usage FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_permission('manage:discounts'));
