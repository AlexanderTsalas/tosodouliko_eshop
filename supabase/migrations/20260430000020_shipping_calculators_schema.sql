-- =============================================================================
-- wf-026 — Shipping calculators schema (+ shipping_zones, shipping_rates_tiers)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.shipping_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  country_codes text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shipping_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shipping_zones_select_public"
  ON public.shipping_zones FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY "shipping_zones_admin_write"
  ON public.shipping_zones FOR ALL TO authenticated
  USING (public.has_permission('manage:shipping'))
  WITH CHECK (public.has_permission('manage:shipping'));

-- ---------------------------------------------------------------------------
-- shipping_rates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shipping_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier text NOT NULL,
  zone text NOT NULL,
  zone_id uuid REFERENCES public.shipping_zones(id) ON DELETE SET NULL,
  min_weight_g integer NOT NULL DEFAULT 0,
  max_weight_g integer,
  min_order_amount numeric(10,2),
  rate numeric(10,2) NOT NULL,
  free_above numeric(10,2),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (rate >= 0)
);

CREATE INDEX IF NOT EXISTS idx_shipping_rates_zone_carrier
  ON public.shipping_rates(zone, carrier) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_shipping_rates_zone_id
  ON public.shipping_rates(zone_id);
CREATE INDEX IF NOT EXISTS idx_shipping_rates_active
  ON public.shipping_rates(active) WHERE active = true;

ALTER TABLE public.shipping_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shipping_rates_select_public"
  ON public.shipping_rates FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY "shipping_rates_admin_write"
  ON public.shipping_rates FOR ALL TO authenticated
  USING (public.has_permission('manage:shipping'))
  WITH CHECK (public.has_permission('manage:shipping'));

-- ---------------------------------------------------------------------------
-- shipping_rates_tiers (graduated pricing by weight or amount)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shipping_rates_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_id uuid NOT NULL REFERENCES public.shipping_rates(id) ON DELETE CASCADE,
  min_value numeric(10,2) NOT NULL,
  max_value numeric(10,2),
  price numeric(10,2) NOT NULL,
  unit text NOT NULL DEFAULT 'weight',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (unit IN ('weight', 'amount', 'quantity'))
);

CREATE INDEX IF NOT EXISTS idx_shipping_rates_tiers_rate_id
  ON public.shipping_rates_tiers(rate_id);

ALTER TABLE public.shipping_rates_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shipping_rates_tiers_select_public"
  ON public.shipping_rates_tiers FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY "shipping_rates_tiers_admin_write"
  ON public.shipping_rates_tiers FOR ALL TO authenticated
  USING (public.has_permission('manage:shipping'))
  WITH CHECK (public.has_permission('manage:shipping'));
