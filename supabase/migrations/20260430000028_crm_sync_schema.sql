-- =============================================================================
-- wf-010 — CRM sync schema
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.crm_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  crm_id text NOT NULL,
  crm_provider text NOT NULL,
  email text NOT NULL,
  first_name text,
  last_name text,
  sync_status text NOT NULL DEFAULT 'pending',
  last_synced_at timestamptz,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (crm_provider, crm_id),
  CHECK (sync_status IN ('pending', 'synced', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_user_id
  ON public.crm_contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_external_id
  ON public.crm_contacts(crm_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_sync_status
  ON public.crm_contacts(sync_status) WHERE sync_status != 'synced';

ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;

-- Service role only — accessed via syncContactToCRM service.
-- No SELECT/INSERT/UPDATE/DELETE policies for non-admin users.
CREATE POLICY "crm_contacts_admin_only"
  ON public.crm_contacts FOR ALL TO authenticated
  USING (public.has_permission('manage:users'))
  WITH CHECK (public.has_permission('manage:users'));
