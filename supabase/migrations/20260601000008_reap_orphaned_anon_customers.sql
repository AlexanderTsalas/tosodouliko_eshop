-- =============================================================================
-- Periodic reaper for orphaned anonymous-customer rows.
--
-- Background: signInAnonymously() (called from add-to-cart and other early
-- gates) cascades into a `customers` row via the user_profiles INSERT trigger.
-- Most of those visitors never check out, so we accumulate empty `customers`
-- rows — visible in the admin Πελάτες tab as "(χωρίς όνομα)" entries with
-- zero orders and no contact info.
--
-- This reaper deletes a `customers` row when ALL of the following hold:
--   * Linked auth.users.is_anonymous = true (it's a guest, not a real account)
--   * All four contact fields are NULL (first_name, last_name, email, phone)
--   * Older than 48h (gives a returning-same-day visitor a window before the
--     row vanishes — anon sessions outlive a single browser hit)
--   * No orders reference it (it never converted)
--   * No active soft/hard cart_checkout_sessions reference it (not mid-flow)
--   * No soft_waits reference it (not in any contention queue)
--   * No live priority_holds reference it (not currently promoted)
--
-- The contention workflow is untouched: rows actively participating in any
-- inventory locking stay. The reaper only targets rows that exist purely as
-- a side-effect of a browse-and-leave session.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reap_orphaned_anon_customers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer := 0;
  v_threshold timestamptz := now() - interval '48 hours';
BEGIN
  WITH orphans AS (
    SELECT c.id
    FROM public.customers c
    JOIN auth.users u ON u.id = c.auth_user_id
    WHERE u.is_anonymous = true
      AND c.first_name IS NULL
      AND c.last_name IS NULL
      AND c.email IS NULL
      AND c.phone IS NULL
      AND c.created_at < v_threshold
      AND NOT EXISTS (
        SELECT 1 FROM public.orders o WHERE o.customer_id = c.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.cart_checkout_sessions s
        WHERE s.customer_id = c.id
          AND s.state IN ('soft', 'hard')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.soft_waits w WHERE w.customer_id = c.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.priority_holds p
        WHERE p.customer_id = c.id
          AND p.consumed_at IS NULL
          AND p.expires_at > now()
      )
  )
  DELETE FROM public.customers
  WHERE id IN (SELECT id FROM orphans);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.reap_orphaned_anon_customers IS
  'Periodic cleanup: deletes customers rows for anonymous auth users that have no contact info, no orders, and no active contention state. Cascades drop their empty user_profiles/wishlists/etc. via FK. Scheduled every 6h via pg_cron; callable manually.';

-- Schedule via pg_cron. Wrapped in a DO block so the migration doesn't abort
-- if pg_cron isn't enabled on this project.
DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('reap-orphaned-anon-customers');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Every 6 hours. Cleanup isn't time-critical; the goal is to keep the
  -- admin Πελάτες tab tidy, not to minimize the orphan window.
  PERFORM cron.schedule(
    'reap-orphaned-anon-customers',
    '0 */6 * * *',
    'SELECT public.reap_orphaned_anon_customers()'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE
    'pg_cron scheduling failed: %. reap_orphaned_anon_customers() is still callable manually.',
    SQLERRM;
END $$;
