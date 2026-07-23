-- =============================================================================
-- Out-of-stock visibility cascade.
--
-- Three levels — global, per-product, per-variant — resolved variant →
-- product → global, first non-null wins. The resolved boolean controls
-- whether an OOS variant remains visible on the storefront:
--   resolved=true  → OOS variant appears in catalog, picker, sitemap, URL
--                    works; customer can use the wishlist / notify-me flow.
--   resolved=false → OOS variant is hidden everywhere: picker chip removed,
--                    catalog card removed, sitemap URL excluded, direct URL
--                    returns 404.
--
-- The default is FALSE to preserve current behavior (OOS items are hidden).
-- Merchants who want the wishlist flow flip the global to TRUE, or set
-- per-product / per-variant overrides as needed.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Singleton table for storefront-wide toggles
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.storefront_settings (
  id integer PRIMARY KEY DEFAULT 1,
  show_when_oos_default boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (id = 1)
);

-- Seed the singleton row.
INSERT INTO public.storefront_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

ALTER TABLE public.storefront_settings ENABLE ROW LEVEL SECURITY;

-- Readable by everyone — the global default affects what the public storefront
-- shows, so anonymous users need to read it (or the storefront server has to
-- fetch it via admin client; readability avoids the latter overhead).
CREATE POLICY "storefront_settings_select_public"
  ON public.storefront_settings FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "storefront_settings_admin_write"
  ON public.storefront_settings FOR ALL TO authenticated
  USING (public.has_permission('manage:settings'))
  WITH CHECK (public.has_permission('manage:settings'));

COMMENT ON COLUMN public.storefront_settings.show_when_oos_default IS
  'Storefront-wide default for whether out-of-stock variants remain visible. Overridden per-product (products.show_when_oos) and per-variant (product_variants.show_when_oos), NULL = inherit.';

-- ---------------------------------------------------------------------------
-- 2. Per-product override
-- ---------------------------------------------------------------------------

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS show_when_oos boolean NULL;

COMMENT ON COLUMN public.products.show_when_oos IS
  'Override of storefront_settings.show_when_oos_default for this product. NULL = inherit. Variant-level override (product_variants.show_when_oos) takes precedence.';

-- ---------------------------------------------------------------------------
-- 3. Per-variant override
-- ---------------------------------------------------------------------------

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS show_when_oos boolean NULL;

COMMENT ON COLUMN public.product_variants.show_when_oos IS
  'Override of product/global show_when_oos. NULL = inherit from product.show_when_oos, then storefront_settings.show_when_oos_default.';

-- ---------------------------------------------------------------------------
-- 4. Resolution function — walks variant → product → global, COALESCE chain
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_show_when_oos(p_variant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    v.show_when_oos,
    p.show_when_oos,
    (SELECT show_when_oos_default FROM public.storefront_settings WHERE id = 1),
    false
  )
  FROM public.product_variants v
  JOIN public.products p ON p.id = v.product_id
  WHERE v.id = p_variant_id;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_show_when_oos(uuid) TO anon, authenticated;
