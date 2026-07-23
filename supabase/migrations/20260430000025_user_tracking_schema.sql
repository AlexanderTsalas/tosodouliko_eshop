-- =============================================================================
-- wf-029 — User tracking schema
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tracking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_name text NOT NULL,
  properties jsonb,
  url text,
  referrer text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracking_events_session_id
  ON public.tracking_events(session_id);
CREATE INDEX IF NOT EXISTS idx_tracking_events_name
  ON public.tracking_events(event_name);
CREATE INDEX IF NOT EXISTS idx_tracking_events_created_at
  ON public.tracking_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracking_events_user_id
  ON public.tracking_events(user_id) WHERE user_id IS NOT NULL;

ALTER TABLE public.tracking_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tracking_events_insert_anyone"
  ON public.tracking_events FOR INSERT TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY "tracking_events_select_admin"
  ON public.tracking_events FOR SELECT TO authenticated
  USING (public.has_permission('read:tracking'));
