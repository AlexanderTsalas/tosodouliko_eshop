-- =============================================================================
-- wf-012 — Dynamic SEO schema
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.seo_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  title text,
  description text,
  og_image_url text,
  robots text DEFAULT 'index,follow',
  canonical_url text,
  no_index boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_seo_metadata_resource
  ON public.seo_metadata(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_seo_metadata_entity
  ON public.seo_metadata(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_seo_metadata_no_index
  ON public.seo_metadata(no_index) WHERE no_index = true;

ALTER TABLE public.seo_metadata ENABLE ROW LEVEL SECURITY;

-- Served via server components only — service role bypasses RLS for reads.
CREATE POLICY "seo_metadata_select_admin"
  ON public.seo_metadata FOR SELECT TO authenticated
  USING (public.has_permission('manage:seo'));
CREATE POLICY "seo_metadata_admin_write"
  ON public.seo_metadata FOR ALL TO authenticated
  USING (public.has_permission('manage:seo'))
  WITH CHECK (public.has_permission('manage:seo'));
