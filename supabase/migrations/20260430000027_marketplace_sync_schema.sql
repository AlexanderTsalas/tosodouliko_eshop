-- =============================================================================
-- wf-016 — Marketplace sync schema
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  marketplace text NOT NULL,
  external_id text,
  status text NOT NULL DEFAULT 'pending',
  sync_errors jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, marketplace),
  CHECK (status IN ('pending', 'active', 'error', 'delisted'))
);

CREATE INDEX IF NOT EXISTS idx_marketplace_listings_product_id
  ON public.marketplace_listings(product_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_marketplace
  ON public.marketplace_listings(marketplace);
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_status
  ON public.marketplace_listings(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_external_id
  ON public.marketplace_listings(external_id) WHERE external_id IS NOT NULL;

ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;

-- Service role only — no user-facing access.
CREATE POLICY "marketplace_listings_admin_only"
  ON public.marketplace_listings FOR ALL TO authenticated
  USING (public.has_permission('manage:products'))
  WITH CHECK (public.has_permission('manage:products'));
