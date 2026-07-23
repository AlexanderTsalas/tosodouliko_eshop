-- =============================================================================
-- wf-018 — Multi-currency schema
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.currencies (
  code text PRIMARY KEY,
  name text NOT NULL,
  symbol text NOT NULL,
  exchange_rate numeric(18,6) NOT NULL DEFAULT 1.0,
  decimal_digits smallint NOT NULL DEFAULT 2,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (exchange_rate > 0)
);

CREATE INDEX IF NOT EXISTS idx_currencies_active
  ON public.currencies(code) WHERE active = true;

ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "currencies_select_public"
  ON public.currencies FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY "currencies_admin_write"
  ON public.currencies FOR ALL TO authenticated
  USING (public.has_permission('manage:currencies'))
  WITH CHECK (public.has_permission('manage:currencies'));

-- Seed default currencies.
INSERT INTO public.currencies (code, name, symbol, exchange_rate, decimal_digits, active) VALUES
  ('EUR', 'Euro', '€', 1.0, 2, true),
  ('USD', 'US Dollar', '$', 1.08, 2, true),
  ('GBP', 'Pound Sterling', '£', 0.85, 2, true)
ON CONFLICT (code) DO NOTHING;
