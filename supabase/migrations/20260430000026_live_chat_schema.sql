-- =============================================================================
-- wf-015 — Live chat schema (+ chat_messages)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'waiting',
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  visitor_name text,
  visitor_email text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CHECK (status IN ('waiting', 'active', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id
  ON public.chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_agent_id
  ON public.chat_sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_status
  ON public.chat_sessions(status) WHERE status != 'closed';

ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_sessions_select_own_or_agent"
  ON public.chat_sessions FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR agent_id = auth.uid()
    OR public.has_permission('manage:chat')
  );
CREATE POLICY "chat_sessions_insert_anyone"
  ON public.chat_sessions FOR INSERT TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY "chat_sessions_update_participant"
  ON public.chat_sessions FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid() OR agent_id = auth.uid()
    OR public.has_permission('manage:chat')
  );

-- ---------------------------------------------------------------------------
-- chat_messages — separate table for queryable per-message storage
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_type text NOT NULL,
  content text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sender_type IN ('visitor', 'user', 'agent', 'system'))
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id
  ON public.chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at
  ON public.chat_messages(created_at);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_messages_select_participant"
  ON public.chat_messages FOR SELECT TO authenticated
  USING (
    session_id IN (
      SELECT id FROM public.chat_sessions
      WHERE user_id = auth.uid() OR agent_id = auth.uid()
    )
    OR public.has_permission('manage:chat')
  );
CREATE POLICY "chat_messages_insert_participant"
  ON public.chat_messages FOR INSERT TO anon, authenticated
  WITH CHECK (true);
