-- =============================================================================
-- wf-008 — Category navigation schema
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  image_url text,
  display_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_categories_parent_id
  ON public.categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_slug
  ON public.categories(slug);
CREATE INDEX IF NOT EXISTS idx_categories_active
  ON public.categories(active, display_order) WHERE active = true;

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "categories_select_public"
  ON public.categories FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY "categories_admin_write"
  ON public.categories FOR ALL TO authenticated
  USING (public.has_permission('manage:categories'))
  WITH CHECK (public.has_permission('manage:categories'));
