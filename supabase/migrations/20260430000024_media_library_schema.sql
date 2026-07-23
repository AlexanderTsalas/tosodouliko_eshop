-- =============================================================================
-- wf-017 — Media library schema
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploader_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  bucket text NOT NULL,
  storage_key text NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  alt_text text,
  folder text,
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket, storage_key)
);

CREATE INDEX IF NOT EXISTS idx_media_assets_uploaded_by
  ON public.media_assets(uploader_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_folder
  ON public.media_assets(folder);
CREATE INDEX IF NOT EXISTS idx_media_assets_mime_type
  ON public.media_assets(mime_type);
CREATE INDEX IF NOT EXISTS idx_media_assets_public
  ON public.media_assets(is_public) WHERE is_public = true;

ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "media_assets_select_authenticated"
  ON public.media_assets FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "media_assets_select_public_anon"
  ON public.media_assets FOR SELECT TO anon
  USING (is_public = true);
CREATE POLICY "media_assets_insert_authenticated"
  ON public.media_assets FOR INSERT TO authenticated
  WITH CHECK (uploader_id = auth.uid() OR public.has_permission('manage:media'));
CREATE POLICY "media_assets_delete_own_or_admin"
  ON public.media_assets FOR DELETE TO authenticated
  USING (uploader_id = auth.uid() OR public.has_permission('manage:media'));
