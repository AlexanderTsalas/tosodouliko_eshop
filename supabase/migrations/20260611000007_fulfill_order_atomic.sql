-- =============================================================================
-- Phase 3a — fulfill_order_atomic.
--
-- Background:
--   The legacy fulfillOrder.ts (src/lib/fulfillment/fulfillOrder.ts)
--   loops over order_items doing consume_reservation + cost-snapshot
--   updates SEQUENTIALLY from JS. If item 3 of 5 fails, items 1-2
--   have already been consumed with no rollback. Stripe webhook
--   retries then can't safely re-run because they'd double-consume.
--
--   This atomic RPC compresses the inventory consume loop + order
--   status flip into ONE transaction. The cost-snapshot (weighted
--   average cost) stays in JS as a best-effort idempotent step
--   AFTER the RPC succeeds — it's a reporting concern, not a
--   correctness concern, and porting it would require duplicating
--   currency-matching logic that already exists in TS.
--
--   The decrement_inventory fallback (for orders placed before the
--   Phase 1 reservation deploy) is preserved.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fulfill_order_atomic(
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row   public.orders%ROWTYPE;
  v_item  record;
  v_count integer := 0;
  v_decrement_fallbacks integer := 0;
BEGIN
  -- Load + validate eligibility (idempotent on already-fulfilled status)
  SELECT * INTO v_row FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ORDER_NOT_FOUND';
  END IF;

  -- Idempotent: caller can fire this multiple times safely. The
  -- statuses below all mean inventory has already been consumed.
  IF v_row.fulfillment_status IN ('preparing', 'shipped', 'ready_for_pickup', 'delivered', 'picked_up') THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_fulfilled', true,
      'order_id', p_order_id,
      'items_consumed', 0
    );
  END IF;

  -- Pre-condition: Stripe-paid orders only. Non-Stripe orders take the
  -- reservation path via transitionOrderStatus. The JS caller checks
  -- this too, but defense-in-depth here protects against direct RPC
  -- misuse if EXECUTE is ever inadvertently granted.
  IF v_row.payment_method <> 'stripe' OR v_row.payment_status <> 'paid' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = format(
        'BAD_STATE: cannot fulfill from (%s, %s, %s)',
        v_row.payment_method, v_row.payment_status, v_row.fulfillment_status
      );
  END IF;

  -- Loop order_items: consume_reservation, fall back to direct
  -- decrement for pre-Phase-1 orders that didn't reserve.
  -- Atomicity: any error rolls back the whole transaction including
  -- earlier successful consumes within this function call.
  FOR v_item IN
    SELECT id, variant_id, quantity
    FROM public.order_items
    WHERE order_id = p_order_id AND variant_id IS NOT NULL
  LOOP
    -- Try consume_reservation first (standard Phase 1 path)
    UPDATE public.inventory_items
       SET quantity_reserved = quantity_reserved - v_item.quantity,
           updated_at = now()
     WHERE variant_id = v_item.variant_id
       AND quantity_reserved >= v_item.quantity;

    IF NOT FOUND THEN
      -- Fallback for pre-Phase-1 orders (no reservation exists).
      -- Direct decrement from available. Safe to remove once all
      -- pre-Phase-1 stripe orders have cleared (typically 24-48h).
      UPDATE public.inventory_items
         SET quantity_available = quantity_available - v_item.quantity,
             updated_at = now()
       WHERE variant_id = v_item.variant_id
         AND quantity_available >= v_item.quantity;

      IF NOT FOUND THEN
        RAISE EXCEPTION USING
          ERRCODE = 'IRSRV',
          MESSAGE = format(
            'INSUFFICIENT_RESERVED for variant %s (qty %s, order_item %s)',
            v_item.variant_id, v_item.quantity, v_item.id
          );
      END IF;
      v_decrement_fallbacks := v_decrement_fallbacks + 1;
    END IF;
    v_count := v_count + 1;
  END LOOP;

  -- Flip the order status. Same statement as JS path; here it shares
  -- the transaction with the inventory consume loop above.
  UPDATE public.orders
     SET fulfillment_status = 'preparing',
         updated_at = now()
   WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'ok', true,
    'already_fulfilled', false,
    'order_id', p_order_id,
    'items_consumed', v_count,
    'decrement_fallbacks', v_decrement_fallbacks
  );
END;
$$;

COMMENT ON FUNCTION public.fulfill_order_atomic(uuid) IS
'Atomically consumes inventory reservations + flips fulfillment_status to "preparing" for a Stripe-paid order. Idempotent. Side effects (WAC snapshot, customer email, audit log) stay in the JS wrapper.';

REVOKE EXECUTE ON FUNCTION public.fulfill_order_atomic(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fulfill_order_atomic(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
