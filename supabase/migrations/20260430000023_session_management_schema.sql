-- =============================================================================
-- wf-025 — Session management schema
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_token text NOT NULL UNIQUE,
  device_name text,
  ip_address inet,
  user_agent text,
  active boolean NOT NULL DEFAULT true,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
  ON public.user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token
  ON public.user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active
  ON public.user_sessions(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_user_sessions_last_active
  ON public.user_sessions(last_active_at DESC);

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_sessions_select_own"
  ON public.user_sessions FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "user_sessions_delete_own"
  ON public.user_sessions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- INSERTs come from auth flows via service role.

-- Cleanup function — removes sessions past their expires_at.
CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.user_sessions
  WHERE expires_at < now() OR (active = false AND last_active_at < now() - interval '30 days');
END;
$$;
