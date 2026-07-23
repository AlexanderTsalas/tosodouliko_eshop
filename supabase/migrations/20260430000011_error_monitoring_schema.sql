-- =============================================================================
-- wf-013 — Error monitoring schema
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.error_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL UNIQUE,
  message text NOT NULL,
  stack_trace text,
  level text NOT NULL DEFAULT 'error',
  severity text NOT NULL DEFAULT 'error',
  type text,
  context jsonb,
  user_id uuid,
  resolved boolean NOT NULL DEFAULT false,
  occurrence_count integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (level IN ('debug', 'info', 'warn', 'error', 'fatal')),
  CHECK (severity IN ('low', 'medium', 'high', 'critical'))
);

CREATE INDEX IF NOT EXISTS idx_error_events_fingerprint
  ON public.error_events(fingerprint);
CREATE INDEX IF NOT EXISTS idx_error_events_resolved
  ON public.error_events(resolved) WHERE resolved = false;
CREATE INDEX IF NOT EXISTS idx_error_events_severity
  ON public.error_events(severity);
CREATE INDEX IF NOT EXISTS idx_error_events_type
  ON public.error_events(type);
CREATE INDEX IF NOT EXISTS idx_error_events_created_at
  ON public.error_events(created_at DESC);

ALTER TABLE public.error_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "error_events_select_admin"
  ON public.error_events FOR SELECT TO authenticated
  USING (public.has_permission('read:errors'));

-- INSERT/UPDATE/DELETE blocked for non-service-role; service role bypasses RLS.
