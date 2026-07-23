-- =============================================================================
-- Admin-configurable transactional email provider.
--
-- Stores one row per configured provider (SMTP/Gmail, Resend, etc.). Exactly
-- one row is `is_active=true` at any time — enforced by a partial unique index.
-- All transactional sends (order shipped, order paid, password reset, etc.)
-- route through the active row.
--
-- Secrets (SMTP password, API key) are AES-256-GCM-encrypted application-side
-- with the EMAIL_SECRETS_KEY env var before insert. The DB only ever sees
-- ciphertext bytes. Loss of the env var = inability to decrypt existing rows
-- but no leak (storage alone is useless).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Permission
-- ---------------------------------------------------------------------------

INSERT INTO public.permissions (name, resource, action, description) VALUES
  ('manage:settings', 'settings', 'manage', 'Manage system settings (email provider, integrations, etc.)')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'admin' AND p.name = 'manage:settings'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Enum: email_provider_kind
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'email_provider_kind') THEN
    CREATE TYPE public.email_provider_kind AS ENUM ('smtp', 'resend');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- email_provider_configs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.email_provider_configs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               public.email_provider_kind NOT NULL,
  display_name       text NOT NULL,
  from_address       text NOT NULL,
  reply_to           text,
  -- Non-secret settings: SMTP host/port/username, Resend domain, etc.
  -- Stored as jsonb so each provider type stores its own shape.
  config             jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- AES-256-GCM ciphertext of secrets. App-side encryption with EMAIL_SECRETS_KEY.
  -- Layout: 12-byte IV || ciphertext || 16-byte auth tag.
  -- NULL means "no secret yet" (e.g., row freshly created, password not entered).
  secrets_encrypted  bytea,
  is_active          boolean NOT NULL DEFAULT false,
  last_test_at       timestamptz,
  last_test_status   text,
  last_test_message  text,
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Exactly one active provider at any time. Toggling another to active
-- requires the app to first set the previous one inactive in the same
-- transaction (handled in setActiveProvider action).
CREATE UNIQUE INDEX IF NOT EXISTS one_active_email_provider
  ON public.email_provider_configs(is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_email_provider_configs_kind
  ON public.email_provider_configs(kind);

ALTER TABLE public.email_provider_configs ENABLE ROW LEVEL SECURITY;

-- Admin-only — no customer-side reads. Secrets must not leak to any other role.
CREATE POLICY "email_provider_configs_admin_select"
  ON public.email_provider_configs FOR SELECT TO authenticated
  USING (public.has_permission('manage:settings'));

CREATE POLICY "email_provider_configs_admin_write"
  ON public.email_provider_configs FOR ALL TO authenticated
  USING (public.has_permission('manage:settings'))
  WITH CHECK (public.has_permission('manage:settings'));

COMMENT ON COLUMN public.email_provider_configs.secrets_encrypted IS
  'AES-256-GCM ciphertext of provider secrets (SMTP password / API key). 12-byte IV || ciphertext || 16-byte auth tag. Encrypted app-side with EMAIL_SECRETS_KEY.';
