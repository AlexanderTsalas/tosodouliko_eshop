-- =============================================================================
-- MFA enrollment hardening: token-gated enrollment + recovery codes.
--
-- Problem solved: previously, anyone with an admin account's password could
-- log in, navigate to /admin/mfa-enroll, and bind their OWN authenticator
-- app to the account — silently completing MFA enrollment without the
-- legitimate admin's knowledge. That defeats the second factor entirely
-- during the window between account creation and first enrollment.
--
-- Two new tables enforce a layered defense:
--
--   1. mfa_enrollment_tokens — single-use, short-lived tokens required to
--      reach the QR code. Issued by an existing admin (via createUser or a
--      "reset MFA" admin action) and delivered out-of-band to the new
--      admin. A password-only session can no longer reach the enrollment
--      page; the QR is gated behind possession of a valid token.
--
--   2. mfa_recovery_codes — single-use codes generated at successful
--      enrollment, shown ONCE. Using a code at the verify page deletes
--      the user's TOTP factor (handled in application code) and triggers
--      a fresh enrollment-token issuance, so device loss is recoverable
--      without manual DB intervention.
--
-- Token + code values are NEVER stored in plaintext. The DB stores
-- SHA-256 hashes peppered with the MFA_TOKEN_PEPPER env var (added by
-- the admin to .env.local + Vercel). Validation hashes the input with
-- the same pepper and does a constant-time lookup.
--
-- RLS is conservative: both tables are admin-client-only. The server
-- actions run with the service role (createAdminClient). No public read
-- path exists by design — the tokens/codes are not user-discoverable.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- mfa_enrollment_tokens
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mfa_enrollment_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- SHA-256(token || pepper) — stored as hex. The plaintext token is
  -- shown exactly once to the issuing admin, who delivers it out-of-band
  -- to the new admin. Never reconstructable from this column alone.
  token_hash   text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  issued_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mfa_enrollment_tokens_user_active
  ON public.mfa_enrollment_tokens(user_id)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mfa_enrollment_tokens_expires
  ON public.mfa_enrollment_tokens(expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE public.mfa_enrollment_tokens ENABLE ROW LEVEL SECURITY;

-- No SELECT/INSERT/UPDATE/DELETE policies for non-service callers. The
-- service role bypasses RLS by design; the admin server actions use
-- createAdminClient() which runs as service_role. A regular authenticated
-- user has zero access to this table even via crafted PostgREST queries.

COMMENT ON TABLE public.mfa_enrollment_tokens IS
  'Single-use, short-lived tokens that gate /admin/mfa-enroll. Plaintext shown exactly once to the issuing admin; the table stores SHA-256(token || MFA_TOKEN_PEPPER). Service-role only.';
COMMENT ON COLUMN public.mfa_enrollment_tokens.token_hash IS
  'Hex-encoded SHA-256(plaintext_token || MFA_TOKEN_PEPPER). Lookup is constant-time via direct equality on this column.';
COMMENT ON COLUMN public.mfa_enrollment_tokens.expires_at IS
  'Default validity is 24h from creation (set by the application). Tokens past expiry are inert.';

-- ---------------------------------------------------------------------------
-- mfa_recovery_codes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mfa_recovery_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Same hashing scheme as enrollment tokens. Codes are short
  -- (XXXX-XXXX, ~8 alphanumeric chars), so we rely entirely on the
  -- pepper for unpredictability under offline attack.
  code_hash    text NOT NULL UNIQUE,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mfa_recovery_codes_user_active
  ON public.mfa_recovery_codes(user_id)
  WHERE consumed_at IS NULL;

ALTER TABLE public.mfa_recovery_codes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.mfa_recovery_codes IS
  'Single-use device-recovery codes issued at successful MFA enrollment. Plaintext shown exactly once at the end of enrollment. Using a code via /admin/mfa-verify deletes the user TOTP factor and re-issues a fresh enrollment token. Service-role only.';

-- ---------------------------------------------------------------------------
-- Bootstrap helper: mint_mfa_enrollment_token(user_uuid)
--
-- Lets an operator with database access (initial admin bootstrap, or
-- recovery from a fully locked-out admin set) mint an enrollment token
-- without going through the application layer. Returns the plaintext;
-- prints it to the SQL output. Caller is responsible for delivering it
-- to the target admin and treating it as a credential.
--
-- IMPORTANT: this function expects the MFA_TOKEN_PEPPER value via the
-- second argument because PostgreSQL functions can't read OS env vars
-- directly. Callers from the SQL editor must paste the pepper value
-- (visible in .env.local) when invoking; the application layer uses the
-- env var directly and never invokes this function.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mint_mfa_enrollment_token(
  p_user_id uuid,
  p_pepper text,
  p_ttl_hours integer DEFAULT 24
)
RETURNS TABLE(plaintext_token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plaintext text;
  v_hash text;
BEGIN
  -- 24 bytes of randomness → 32-char base64url. Plenty of entropy.
  v_plaintext := encode(gen_random_bytes(24), 'base64');
  -- Strip URL-unsafe chars without changing meaningful entropy.
  v_plaintext := translate(v_plaintext, '+/=', '-_');

  -- SHA-256(plaintext || pepper) — must match the application's hash
  -- algorithm in src/lib/mfa/tokens.ts.
  v_hash := encode(digest(v_plaintext || p_pepper, 'sha256'), 'hex');

  -- Invalidate any prior un-consumed tokens for this user. A user can
  -- only have one active enrollment token at a time — the most-recent
  -- mint wins.
  UPDATE public.mfa_enrollment_tokens
     SET consumed_at = now()
   WHERE user_id = p_user_id
     AND consumed_at IS NULL;

  INSERT INTO public.mfa_enrollment_tokens
    (user_id, token_hash, expires_at, issued_by)
  VALUES
    (p_user_id, v_hash, now() + (p_ttl_hours::text || ' hours')::interval, NULL);

  -- Audit row so the bootstrap mint is visible in audit_events.
  INSERT INTO public.audit_events
    (actor_id, actor_type, action, resource_type, resource_id, metadata)
  VALUES
    (NULL, 'system', 'mfa.enrollment_token.minted_via_sql', 'user', p_user_id::text,
     jsonb_build_object('ttl_hours', p_ttl_hours));

  RETURN QUERY SELECT v_plaintext;
END;
$$;

COMMENT ON FUNCTION public.mint_mfa_enrollment_token(uuid, text, integer)
IS 'Bootstrap-only helper to mint an MFA enrollment token. Returns the plaintext token — treat as credential, deliver out-of-band. Application code uses the server action instead.';

-- pgcrypto must be enabled for gen_random_bytes() and digest(). Most
-- Supabase projects have it on by default; this is idempotent.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
