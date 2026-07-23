-- =============================================================================
-- Phase 0a — REVOKE EXECUTE on unsafe SECURITY DEFINER functions.
--
-- Background:
--   A performance-audit pass surfaced a parallel security problem: many
--   existing SECURITY DEFINER functions never had their PostgreSQL
--   default EXECUTE grant scoped down. Any authenticated user can call
--   them via PostgREST today.
--
--   The most critical examples:
--
--     - grant_role_by_email / grant_admin_by_email / revoke_role_by_email:
--       self-grant the 'admin' role to any account. CRITICAL.
--     - commit_order_with_lines: insert arbitrary orders under any
--       customer_id, bypassing the orders/order_items RLS. HIGH.
--     - merge_offline_customer: move orders + delete customer rows
--       under any source→target pair. HIGH.
--     - mint_mfa_enrollment_token: mint MFA tokens for any user if the
--       pepper is known. HIGH.
--     - increment_inventory: inflate stock arbitrarily. HIGH.
--     - Every inventory primitive (hold_soft, reserve_inventory,
--       promote_*, release_*, consume_*): move other shoppers'
--       inventory buckets by id. HIGH.
--     - log_audit_event: spoof audit rows under any actor_id. MED.
--     - reap_orphaned_anon_customers: deletes customer rows. MED.
--
-- Every legitimate caller of these functions uses createAdminClient()
-- (service_role), so the legitimate path is unaffected. PostgREST
-- callers (authenticated, anon) lose access.
--
-- Rollback: a single `GRANT EXECUTE ... TO authenticated` re-applies
-- the previous behavior. See "rollback" section at the bottom for
-- pre-built statements (commented out).
-- =============================================================================

-- ──── Critical: RBAC bootstrap functions ─────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.grant_role_by_email(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.grant_admin_by_email(text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_role_by_email(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_role_by_email(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_admin_by_email(text)      TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_role_by_email(text, text) TO service_role;

-- ──── Inventory primitives ───────────────────────────────────────────────────
-- (variant_id, qty) parameters let any authenticated user move other
-- shoppers' buckets. Lock down to service_role.
REVOKE EXECUTE ON FUNCTION public.hold_soft(uuid, integer)              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_soft(uuid, integer)           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_inventory(uuid, integer)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_reservation(uuid, integer)    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.promote_soft_to_reserved(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_reservation(uuid, integer)    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.restore_inventory(uuid, integer)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decrement_inventory(uuid, integer)    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_inventory(uuid, integer)    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_priority(uuid, integer)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.promote_to_priority(uuid, integer)    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_priority_to_soft(uuid, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.hold_soft(uuid, integer)              TO service_role;
GRANT EXECUTE ON FUNCTION public.release_soft(uuid, integer)           TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_inventory(uuid, integer)      TO service_role;
GRANT EXECUTE ON FUNCTION public.release_reservation(uuid, integer)    TO service_role;
GRANT EXECUTE ON FUNCTION public.promote_soft_to_reserved(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_reservation(uuid, integer)    TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_inventory(uuid, integer)      TO service_role;
GRANT EXECUTE ON FUNCTION public.decrement_inventory(uuid, integer)    TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_inventory(uuid, integer)    TO service_role;
GRANT EXECUTE ON FUNCTION public.release_priority(uuid, integer)       TO service_role;
GRANT EXECUTE ON FUNCTION public.promote_to_priority(uuid, integer)    TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_priority_to_soft(uuid, integer) TO service_role;

-- ──── Order + customer commit RPCs ───────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.commit_order_with_lines(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.merge_offline_customer(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_order_with_lines(jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_offline_customer(uuid, uuid)    TO service_role;

-- ──── MFA enrollment token minting ───────────────────────────────────────────
-- Token mint pepper-as-arg is not a sufficient barrier; anyone who can
-- guess/leak the pepper string can mint an MFA token for any user.
REVOKE EXECUTE ON FUNCTION public.mint_mfa_enrollment_token(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mint_mfa_enrollment_token(uuid, text, integer)
  TO service_role;

-- ──── Audit + customer reapers ───────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.log_audit_event(uuid, text, text, text, text, jsonb, inet)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reap_orphaned_anon_customers()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_audit_event(uuid, text, text, text, text, jsonb, inet)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reap_orphaned_anon_customers() TO service_role;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Rollback (do NOT uncomment without explicit decision):
-- =============================================================================
-- GRANT EXECUTE ON FUNCTION public.grant_role_by_email(text, text)            TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.grant_admin_by_email(text)                 TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.revoke_role_by_email(text, text)           TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.hold_soft(uuid, integer)                   TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.release_soft(uuid, integer)                TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.reserve_inventory(uuid, integer)           TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.release_reservation(uuid, integer)         TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.promote_soft_to_reserved(uuid, integer)    TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.consume_reservation(uuid, integer)         TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.restore_inventory(uuid, integer)           TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.decrement_inventory(uuid, integer)         TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.increment_inventory(uuid, integer)         TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.release_priority(uuid, integer)            TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.promote_to_priority(uuid, integer)         TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.consume_priority_to_soft(uuid, integer)    TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.commit_order_with_lines(jsonb, jsonb)      TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.merge_offline_customer(uuid, uuid)         TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.mint_mfa_enrollment_token(uuid, text, integer) TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.log_audit_event(uuid, text, text, text, text, jsonb, inet) TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.reap_orphaned_anon_customers()             TO authenticated;
