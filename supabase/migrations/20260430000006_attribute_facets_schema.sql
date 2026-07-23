-- =============================================================================
-- wf-006 — Attribute facets schema
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  type text NOT NULL DEFAULT 'select',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.attributes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attributes_select_public"
  ON public.attributes FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY "attributes_admin_write"
  ON public.attributes FOR ALL TO authenticated
  USING (public.has_permission('manage:attributes'))
  WITH CHECK (public.has_permission('manage:attributes'));

-- Supplementary: attribute_values (junction, implicit per architecture).
CREATE TABLE IF NOT EXISTS public.attribute_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attribute_id uuid NOT NULL REFERENCES public.attributes(id) ON DELETE CASCADE,
  value text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attribute_id, value)
);

CREATE INDEX IF NOT EXISTS idx_attribute_values_attribute_id
  ON public.attribute_values(attribute_id);

ALTER TABLE public.attribute_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attribute_values_select_public"
  ON public.attribute_values FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY "attribute_values_admin_write"
  ON public.attribute_values FOR ALL TO authenticated
  USING (public.has_permission('manage:attributes'))
  WITH CHECK (public.has_permission('manage:attributes'));
