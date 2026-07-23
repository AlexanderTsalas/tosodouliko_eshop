-- =============================================================================
-- products + product_images + product_categories
--
-- Supplementary tables referenced by the architecture (Tables/products,
-- Tables/product_images, Tables/product_categories, idx_products_active,
-- idx_products_slug, idx_product_images_product_id) but not given an explicit
-- Phase 1 ticket in the spec. Added so downstream features (variants, cart,
-- orders, marketplace, search, SEO) can resolve.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  base_price numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'EUR' REFERENCES public.currencies(code),
  weight_g integer,
  age_min smallint,
  age_max smallint,
  brand text,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_active
  ON public.products(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_products_slug
  ON public.products(slug);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "products_select_public"
  ON public.products FOR SELECT TO anon, authenticated
  USING (active = true OR public.has_permission('manage:products'));
CREATE POLICY "products_admin_write"
  ON public.products FOR ALL TO authenticated
  USING (public.has_permission('manage:products'))
  WITH CHECK (public.has_permission('manage:products'));

-- ---------------------------------------------------------------------------
-- product_images
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  url text NOT NULL,
  alt_text text,
  display_order integer NOT NULL DEFAULT 0,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_images_product_id
  ON public.product_images(product_id);

ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_images_select_public"
  ON public.product_images FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY "product_images_admin_write"
  ON public.product_images FOR ALL TO authenticated
  USING (public.has_permission('manage:products'))
  WITH CHECK (public.has_permission('manage:products'));

-- ---------------------------------------------------------------------------
-- product_categories (junction)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_categories (
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_product_categories_category_id
  ON public.product_categories(category_id);

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_categories_select_public"
  ON public.product_categories FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY "product_categories_admin_write"
  ON public.product_categories FOR ALL TO authenticated
  USING (public.has_permission('manage:products'))
  WITH CHECK (public.has_permission('manage:products'));
