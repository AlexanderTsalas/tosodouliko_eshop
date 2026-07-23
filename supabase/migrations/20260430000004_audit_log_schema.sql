-- =============================================================================
-- wf-007 — Audit log schema
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_type text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  metadata jsonb,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_actor_id
  ON public.audit_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_resource
  ON public.audit_events(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at
  ON public.audit_events(created_at DESC);

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- Immutable log: only SELECT allowed for those with read:audit-log.
CREATE POLICY "audit_events_select_admin"
  ON public.audit_events FOR SELECT TO authenticated
  USING (public.has_permission('read:audit-log'));

-- INSERT/UPDATE/DELETE blocked for everyone except service_role (RLS bypass).
