-- =============================================================================
-- wf-022 — Product variants schema
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku text NOT NULL UNIQUE,
  price numeric(10,2) NOT NULL,
  attribute_combo jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Note: a UNIQUE on (product_id, attribute_combo) requires jsonb to be sortable.
-- Postgres can't index jsonb directly with a UNIQUE constraint without a
-- normalized form, so we use a unique expression on the canonical text form.
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_variants_combo
  ON public.product_variants(product_id, (attribute_combo::text));

CREATE INDEX IF NOT EXISTS idx_product_variants_product_id
  ON public.product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_sku
  ON public.product_variants(sku);
CREATE INDEX IF NOT EXISTS idx_product_variants_active
  ON public.product_variants(is_active) WHERE is_active = true;

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_variants_select_public"
  ON public.product_variants FOR SELECT TO anon, authenticated
  USING (is_active = true OR public.has_permission('manage:products'));
CREATE POLICY "product_variants_admin_write"
  ON public.product_variants FOR ALL TO authenticated
  USING (public.has_permission('manage:products'))
  WITH CHECK (public.has_permission('manage:products'));
