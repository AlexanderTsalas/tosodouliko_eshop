-- =============================================================================
-- Offers engine — Phase 1: record_offer_usage SQL function.
--
-- Atomically increments offers.current_uses + upserts the per-customer
-- counter in offer_customer_usage for ONE OR MORE offers in a single
-- transaction. Called by placeOrder (Phase 4) after the order commit
-- succeeds, with the list of offer IDs that were applied.
--
-- Why one RPC instead of multiple UPDATE statements from the action:
--   - One round-trip vs N (an order can apply multiple offers)
--   - Atomic: either all counters tick or none does — no half-counted
--     state if the action errors mid-update
--   - SECURITY DEFINER so it can write even if the caller's RLS context
--     would otherwise forbid (the placeOrder action uses the admin
--     client anyway, but defense-in-depth)
--
-- Idempotency note:
--   This function is NOT idempotent — calling it twice for the same
--   order doubles the counters. Callers (placeOrder) must guarantee
--   single-invocation per order commit. The order_offer_applications
--   audit table is the durable record; counters are denorm convenience.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.record_offer_usage(
  p_offer_ids   uuid[],
  p_customer_id uuid     -- NULL for guest orders
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Global usage counter on offers itself (used by max_uses_total check
  -- in eligible_offers). Atomic increment via SET column = column + 1
  -- so concurrent calls don't lose updates.
  UPDATE public.offers
  SET current_uses = current_uses + 1
  WHERE id = ANY(p_offer_ids);

  -- Per-customer counter (used by max_uses_per_customer check). Skipped
  -- for guest orders since they have no customer row to track against.
  -- Anonymous-to-permanent customer flow elsewhere in the codebase
  -- handles guest→customer migration via merge_offline_customer; if
  -- offer usage attribution becomes important for guest orders, this
  -- function gets a second arg for the anon session id and writes
  -- there. Not in v1 scope.
  IF p_customer_id IS NOT NULL THEN
    INSERT INTO public.offer_customer_usage (offer_id, customer_id, use_count, last_used_at)
    SELECT unnest(p_offer_ids), p_customer_id, 1, now()
    ON CONFLICT (offer_id, customer_id)
    DO UPDATE SET
      use_count    = public.offer_customer_usage.use_count + 1,
      last_used_at = now();
  END IF;
END;
$$;

-- Only the admin role (used by createAdminClient in server actions)
-- should call this. RLS doesn't gate functions, so we grant explicitly.
REVOKE EXECUTE ON FUNCTION public.record_offer_usage(uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_offer_usage(uuid[], uuid) TO service_role;

COMMENT ON FUNCTION public.record_offer_usage(uuid[], uuid) IS
'Atomically bumps offers.current_uses + offer_customer_usage counters for one or more offers. Called once per order commit by placeOrder. NOT idempotent — the caller must ensure single invocation per order. Restricted to service_role.';

NOTIFY pgrst, 'reload schema';
