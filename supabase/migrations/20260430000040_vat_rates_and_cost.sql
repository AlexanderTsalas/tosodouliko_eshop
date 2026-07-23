-- =============================================================================
-- VAT rates registry + product cost (Phase G1).
--
-- VAT rates are admin-managed (CRUD). Resolution order at read time:
--   product.vat_rate_id ?? category.vat_rate_id ?? rate where is_default = true
-- For multi-category products, lowest rate wins (conservative for tax authority);
-- the app surfaces a warning on the product if more than one category has a rate.
--
-- Cost lives on the product (not the variant) because the supplier invoice
-- normally prices the SKU once; per-variant cost can be layered later if
-- variant-level COGS becomes a real need.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.vat_rates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  code         text NOT NULL UNIQUE,
  rate         numeric(5,4) NOT NULL CHECK (rate >= 0 AND rate < 1),
  is_default   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.vat_rates.rate IS
  'Stored as a fraction in [0,1). E.g. 0.2400 for 24% Greek standard VAT.';

-- Exactly one default at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_vat_rates_one_default
  ON public.vat_rates ((1)) WHERE is_default;

-- Seed Greek standard bands. ON CONFLICT keeps re-runs idempotent.
INSERT INTO public.vat_rates (name, code, rate, is_default) VALUES
  ('Κανονικός (24%)',        'STANDARD',          0.2400, true),
  ('Μειωμένος (13%)',        'REDUCED',           0.1300, false),
  ('Υπερ-μειωμένος (6%)',    'SUPER_REDUCED',     0.0600, false)
ON CONFLICT (code) DO NOTHING;

-- Category-level default (admin-friendly: set once at "Books", everything inherits).
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS vat_rate_id uuid REFERENCES public.vat_rates(id) ON DELETE SET NULL;

-- Product-level override (rare; for one-off products that don't match their category band).
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS vat_rate_id uuid REFERENCES public.vat_rates(id) ON DELETE SET NULL;

-- Wholesale/COGS data — purely informational; the storefront price column stays canonical.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cost_price numeric(10,2);
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cost_currency text;

COMMENT ON COLUMN public.products.cost_price IS
  'Unit wholesale/manufacturing cost. Optional. Drives margin metrics only — has no effect on storefront pricing.';
COMMENT ON COLUMN public.products.cost_currency IS
  'ISO 4217 currency of cost_price. Can differ from products.currency; reports must convert.';

CREATE INDEX IF NOT EXISTS idx_categories_vat_rate_id ON public.categories(vat_rate_id);
CREATE INDEX IF NOT EXISTS idx_products_vat_rate_id   ON public.products(vat_rate_id);

-- Permission + grant to admin role.
INSERT INTO public.permissions (name, resource, action, description) VALUES
  ('manage:vat_rates', 'vat_rates', 'manage', 'Create/update/delete VAT rates')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'admin' AND p.name = 'manage:vat_rates'
ON CONFLICT DO NOTHING;
