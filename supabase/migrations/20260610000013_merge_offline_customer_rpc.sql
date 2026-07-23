-- =============================================================================
-- merge_offline_customer — race-safe auto-merge primitive.
--
-- Background:
--   placeOrder auto-merges an offline customer into the auth-linked
--   customer when it finds a HIGH-confidence signal match. The
--   previous implementation did the merge with separate JS-driven
--   queries:
--     1. UPDATE orders.customer_id  source → target
--     2. UPDATE addresses.customer_id source → target
--     3. DELETE customers WHERE id = source
--
--   Two parallel placeOrder calls from the same user (different tabs,
--   same cart) could both detect the same offline-source candidate
--   and race: both call (1) → both call (3) → second DELETE no-ops
--   harmlessly, but if any non-orders FK points at source between (1)
--   and (3), the DELETE would fail and leave the source dangling.
--
-- This function fixes both:
--   - pg_advisory_xact_lock keyed on the (source, target) pair
--     serializes concurrent calls within Postgres
--   - Re-checks that source still exists after acquiring the lock —
--     loser of the race observes "already_merged" and exits cleanly
--
-- Used by:
--   - src/actions/checkout/placeOrder.ts (HIGH-confidence offline
--     auto-merge at order placement)
--   - src/actions/customers/mergeCustomers.ts (manual admin merge —
--     could be migrated to this primitive too; out of scope here)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.merge_offline_customer(
  p_source_id uuid,
  p_target_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_orders_moved   int;
  v_addresses_moved int;
  v_source_exists   boolean;
BEGIN
  IF p_source_id IS NULL OR p_target_id IS NULL OR p_source_id = p_target_id THEN
    RAISE EXCEPTION 'merge_offline_customer: invalid id pair';
  END IF;

  -- Transaction-scoped advisory lock. Two-int4 form (no need for the
  -- bigint hash trick): seed1 = hash of the pair, seed2 = hash of
  -- 'customer_merge' magic salt so this lock can't collide with other
  -- advisory locks held elsewhere by the same connection.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_source_id::text || ':' || p_target_id::text),
    hashtext('customer_merge')
  );

  -- Loser of the race: source was already merged + deleted by the
  -- concurrent caller. Return success with zero counts so the caller
  -- doesn't error — the work is done.
  SELECT EXISTS (SELECT 1 FROM public.customers WHERE id = p_source_id)
    INTO v_source_exists;
  IF NOT v_source_exists THEN
    RETURN jsonb_build_object(
      'outcome', 'already_merged',
      'orders_moved', 0,
      'addresses_moved', 0
    );
  END IF;

  -- Move historic + present-state records.
  UPDATE public.orders
     SET customer_id = p_target_id
   WHERE customer_id = p_source_id;
  GET DIAGNOSTICS v_orders_moved = ROW_COUNT;

  UPDATE public.addresses
     SET customer_id = p_target_id
   WHERE customer_id = p_source_id;
  GET DIAGNOSTICS v_addresses_moved = ROW_COUNT;

  -- Delete the source shell. If any unexpected FK still pointed at it,
  -- the DELETE raises and the whole transaction rolls back — caller
  -- sees a clear error rather than partial state.
  DELETE FROM public.customers WHERE id = p_source_id;

  RETURN jsonb_build_object(
    'outcome', 'merged',
    'orders_moved', v_orders_moved,
    'addresses_moved', v_addresses_moved
  );
END;
$$;

COMMENT ON FUNCTION public.merge_offline_customer(uuid, uuid) IS
'Race-safe offline-customer merge. Acquires a transaction-scoped advisory lock keyed on (source, target), re-checks source existence, then moves orders + addresses and deletes the source. Concurrent callers serialize through the lock; the second one observes already_merged and exits.';

NOTIFY pgrst, 'reload schema';
