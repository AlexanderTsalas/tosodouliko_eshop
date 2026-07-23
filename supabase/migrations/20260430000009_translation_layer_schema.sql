-- =============================================================================
-- wf-028 — Translation layer schema
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace text NOT NULL,
  key text NOT NULL,
  locale text NOT NULL,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (namespace, key, locale)
);

CREATE INDEX IF NOT EXISTS idx_translations_ns_locale
  ON public.translations(namespace, locale);
CREATE INDEX IF NOT EXISTS idx_translations_key
  ON public.translations(key);
CREATE INDEX IF NOT EXISTS idx_translations_locale
  ON public.translations(locale);
CREATE INDEX IF NOT EXISTS idx_translations_namespace
  ON public.translations(namespace);
CREATE INDEX IF NOT EXISTS idx_translations_lookup
  ON public.translations(namespace, key, locale);

ALTER TABLE public.translations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "translations_select_public"
  ON public.translations FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY "translations_admin_write"
  ON public.translations FOR ALL TO authenticated
  USING (public.has_permission('manage:translations'))
  WITH CHECK (public.has_permission('manage:translations'));
