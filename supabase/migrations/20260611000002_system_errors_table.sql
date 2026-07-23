-- =============================================================================
-- Phase 0b — system_errors observability table + log_system_error helper.
--
-- Background:
--   14+ Postgres functions in this codebase catch with broad
--   `EXCEPTION WHEN OTHERS THEN RAISE NOTICE` blocks. The intent is
--   benign (one bad row shouldn't abort a reaper batch), but the side
--   effect is that real perf failures (lock waits, FK violations,
--   serialization failures) look the same as benign races in the
--   logs — making it impossible to spot degradation.
--
--   Phase 8 of the data-layer performance plan replaces those broad
--   catches with typed-SQLSTATE catches. Non-benign exceptions then
--   flow into this table via `log_system_error`, giving operators a
--   queryable surface for "what's actually going wrong inside the DB."
--
-- This migration:
--   1. Creates `system_errors` — an append-only error log table
--   2. Creates `log_system_error()` — a SECURITY DEFINER helper that
--      INSERTs into the table and is guaranteed to never throw (worst
--      case the error is dropped, never propagated to the caller)
--   3. RLS allows SELECT only for admins with `read:errors`
--   4. INSERT is restricted to service_role via the helper function
--
-- Used by Phase 8 typed-catch functions + Phase 10 admin surface.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.system_errors (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  source       text        NOT NULL,
  severity     text        NOT NULL CHECK (severity IN ('info','warn','error','critical')),
  entity_kind  text,
  entity_id    uuid,
  sqlstate     text        NOT NULL,
  sqlerrm      text        NOT NULL,
  metadata     jsonb,
  resolved_at  timestamptz,
  resolved_by  uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.system_errors IS
'Append-only log of non-benign exceptions caught by Postgres functions (reapers, atomic RPCs, triggers). Populated via log_system_error(). Queried by the /admin/system-errors surface.';

CREATE INDEX IF NOT EXISTS idx_system_errors_occurred
  ON public.system_errors(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_errors_source_occurred
  ON public.system_errors(source, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_errors_unresolved
  ON public.system_errors(occurred_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE public.system_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "system_errors_select_admin"
  ON public.system_errors
  FOR SELECT
  TO authenticated
  USING (public.has_permission('read:errors'));

-- UPDATE only — for marking errors resolved. Restricted to the same
-- permission as read.
CREATE POLICY "system_errors_update_admin"
  ON public.system_errors
  FOR UPDATE
  TO authenticated
  USING (public.has_permission('read:errors'))
  WITH CHECK (public.has_permission('read:errors'));

-- INSERT/DELETE are NOT allowed for any role except service_role
-- (which bypasses RLS). All writes go through log_system_error().

-- =============================================================================
-- log_system_error() — write helper used by typed-catch blocks.
--
-- Contract:
--   - SECURITY DEFINER so the calling function (which may be invoked
--     by a cron job running as the postgres role) can write regardless
--     of RLS.
--   - Inner EXCEPTION WHEN OTHERS catches any failure of the INSERT
--     itself and returns NULL. Logging must NEVER propagate an error
--     to the caller; the worst case is the error event is lost but
--     the original operation succeeds.
--   - SET search_path forces public+pg_temp resolution, blocking
--     search_path manipulation attacks (not strictly required for an
--     INSERT but follows the codebase convention).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.log_system_error(
  p_source      text,
  p_severity    text,
  p_sqlstate    text,
  p_sqlerrm     text,
  p_entity_kind text  DEFAULT NULL,
  p_entity_id   uuid  DEFAULT NULL,
  p_metadata    jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.system_errors (
    source, severity, sqlstate, sqlerrm, entity_kind, entity_id, metadata
  )
  VALUES (
    p_source,
    p_severity,
    p_sqlstate,
    p_sqlerrm,
    p_entity_kind,
    p_entity_id,
    p_metadata
  )
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION
  WHEN OTHERS THEN
    -- Logging must never break the caller. Return NULL so the original
    -- caller's exception-handling block continues as if nothing was
    -- logged. This is the one place where catch-all is justified —
    -- we're already on the slow path of error handling.
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.log_system_error(text, text, text, text, text, uuid, jsonb) IS
'Append a non-benign error to public.system_errors. SECURITY DEFINER + inner catch ensures this NEVER throws to the caller.';

REVOKE EXECUTE ON FUNCTION public.log_system_error(text, text, text, text, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_system_error(text, text, text, text, text, uuid, jsonb)
  TO service_role;

NOTIFY pgrst, 'reload schema';
