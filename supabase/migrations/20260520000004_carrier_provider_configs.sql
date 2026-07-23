-- =============================================================================
-- Admin-configurable carrier integration providers.
--
-- One row per (carrier, active) — i.e. each carrier (ACS, ELTA, BOX NOW, etc.)
-- can hold ONE active configuration at a time, while inactive historical rows
-- may coexist. The merchant can have multiple carriers wired in parallel; the
-- order's `carrier` column decides which one to call at runtime (per-order
-- routing, not a global "active provider").
--
-- Non-secret settings (base URL overrides, sender name, billing code, etc.)
-- live in `config` jsonb. Secrets — ACS calls send AcsApiKey + Company_ID +
-- Company_Password + User_ID + User_Password — are AES-256-GCM-encrypted
-- application-side with the CARRIER_SECRETS_KEY env var before insert.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Permission
-- ---------------------------------------------------------------------------

INSERT INTO public.permissions (name, resource, action, description) VALUES
  ('manage:couriers', 'couriers', 'manage', 'Manage carrier integration providers and their credentials')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'admin' AND p.name = 'manage:couriers'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- carrier_provider_configs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.carrier_provider_configs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Mirrors orders.carrier enum-string. Free text (not a Postgres enum) so
  -- adding a new carrier in app code doesn't require an enum migration.
  carrier            text NOT NULL CHECK (carrier IN ('acs','elta','box_now','speedex','geniki','other')),
  display_name       text NOT NULL,
  -- Non-secret settings. Carrier-specific shape; e.g. for ACS:
  --   { base_url, sender_name, billing_code, default_charge_type, language }
  config             jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- AES-256-GCM ciphertext of secrets (JSON-encoded). App-side encryption with
  -- CARRIER_SECRETS_KEY. Layout: 12-byte IV || ciphertext || 16-byte auth tag.
  -- NULL means "row exists but credentials haven't been entered yet".
  secrets_encrypted  bytea,
  -- Wired in to be called by the order flow. Per carrier: at most one row may
  -- be active. The order's `carrier` column still decides which carrier to
  -- route to — `is_active=false` means "we know about this carrier but the
  -- credentials are stale, don't try to call it".
  is_active          boolean NOT NULL DEFAULT false,
  last_test_at       timestamptz,
  last_test_status   text,
  last_test_message  text,
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- At most one active config per carrier. Multiple carriers active at once is
-- the whole point of this design.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_carrier_provider_per_carrier
  ON public.carrier_provider_configs(carrier) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_carrier_provider_configs_carrier
  ON public.carrier_provider_configs(carrier);

ALTER TABLE public.carrier_provider_configs ENABLE ROW LEVEL SECURITY;

-- Admin-only — credentials must never leak to customers.
CREATE POLICY "carrier_provider_configs_admin_select"
  ON public.carrier_provider_configs FOR SELECT TO authenticated
  USING (public.has_permission('manage:couriers'));

CREATE POLICY "carrier_provider_configs_admin_write"
  ON public.carrier_provider_configs FOR ALL TO authenticated
  USING (public.has_permission('manage:couriers'))
  WITH CHECK (public.has_permission('manage:couriers'));

COMMENT ON COLUMN public.carrier_provider_configs.secrets_encrypted IS
  'AES-256-GCM ciphertext of carrier credentials (JSON-encoded). 12-byte IV || ciphertext || 16-byte auth tag. Encrypted app-side with CARRIER_SECRETS_KEY.';
