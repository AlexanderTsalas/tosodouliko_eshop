-- =============================================================================
-- Phase 3b — refund_order_atomic.
--
-- Background:
--   The legacy refundOrder.ts updates the order row, then loops over
--   order_items calling restore_inventory sequentially. A webhook
--   race can observe "refunded" status with inventory not yet
--   restored. This RPC compresses the order patch + inventory
--   restore loop into one transaction.
--
--   IMPORTANT — what stays OUTSIDE the RPC:
--     - The Stripe (or other provider) refund API call. External
--       network ops MUST NOT run inside a DB transaction. The JS
--       wrapper calls the provider first, gets the refund_id +
--       amount, then calls this RPC with those values.
--     - The audit_events INSERT happens inside the RPC (atomic).
--     - The optimistic-lock check happens inside the RPC as defense
--       in depth (the JS wrapper also checks BEFORE the provider
--       call to avoid issuing a refund against stale state).
--
-- The function accepts a snapshot of the next fulfillment_status
-- ('cancelled' for pre-shipment, 'returned' for post-shipment, or
-- NULL for no change) so the state-machine logic stays in JS — same
-- shape as today, just collapsed into one round-trip.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.refund_order_atomic(
  p_order_id              uuid,
  p_actor_id              uuid,
  p_refund_id             text,
  p_refund_amount_minor   integer,
  p_currency              text,
  p_payment_method        text,
  p_next_fulfillment      text,        -- 'cancelled', 'returned', or NULL
  p_restore_inventory     boolean,
  p_reason                text DEFAULT NULL,
  p_expected_updated_at   timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row    public.orders%ROWTYPE;
  v_item   record;
  v_restored_count integer := 0;
BEGIN
  -- Load + validate
  SELECT * INTO v_row FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ORDER_NOT_FOUND';
  END IF;

  -- Optimistic-lock guard (only if caller supplied an expected timestamp)
  IF p_expected_updated_at IS NOT NULL AND v_row.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'CONCURRENT_EDIT: order updated_at does not match expected';
  END IF;

  -- State check — the JS wrapper checks this too, but defense-in-depth
  -- protects against the (rare) race where another path flipped to
  -- 'refunded' between the JS check and the RPC.
  IF v_row.payment_status = 'refunded' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ALREADY_REFUNDED';
  END IF;
  IF v_row.payment_status <> 'paid' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = format('BAD_STATE: cannot refund from payment_status %s', v_row.payment_status);
  END IF;

  -- Validate p_next_fulfillment is one of the allowed transition targets
  IF p_next_fulfillment IS NOT NULL
     AND p_next_fulfillment NOT IN ('cancelled', 'returned') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = format('Invalid p_next_fulfillment: %s', p_next_fulfillment);
  END IF;

  -- Patch the order row. Single UPDATE so both fields move atomically.
  UPDATE public.orders
     SET payment_status = 'refunded',
         fulfillment_status = COALESCE(p_next_fulfillment, fulfillment_status),
         updated_at = now()
   WHERE id = p_order_id;

  -- Inventory restore — only when requested by the caller. The legacy
  -- rule: Stripe orders that decremented stock but haven't shipped.
  -- We accept this verdict as a boolean so the RPC stays state-machine
  -- agnostic.
  IF p_restore_inventory THEN
    FOR v_item IN
      SELECT variant_id, quantity
        FROM public.order_items
       WHERE order_id = p_order_id AND variant_id IS NOT NULL
    LOOP
      UPDATE public.inventory_items
         SET quantity_available = quantity_available + v_item.quantity,
             updated_at = now()
       WHERE variant_id = v_item.variant_id;
      IF NOT FOUND THEN
        -- restore_inventory's legacy behavior is to RAISE
        -- INVENTORY_NOT_FOUND. Same here so the whole txn rolls
        -- back rather than partially-restoring.
        RAISE EXCEPTION USING
          ERRCODE = '22023',
          MESSAGE = format('INVENTORY_NOT_FOUND for variant %s', v_item.variant_id);
      END IF;
      v_restored_count := v_restored_count + 1;
    END LOOP;
  END IF;

  -- Audit log INSERT inside the transaction so it's atomic with the
  -- state change. Uses the same columns as log_audit_event.
  INSERT INTO public.audit_events (
    actor_id, actor_type, action, resource_type, resource_id, metadata
  )
  VALUES (
    p_actor_id,
    'user',
    'order.refunded',
    'order',
    p_order_id::text,
    jsonb_build_object(
      'refund_id',                 p_refund_id,
      'amount_minor',              p_refund_amount_minor,
      'currency',                  p_currency,
      'payment_method',            p_payment_method,
      'reason',                    p_reason,
      'fulfillment_status_before', v_row.fulfillment_status,
      'fulfillment_status_after',  COALESCE(p_next_fulfillment, v_row.fulfillment_status),
      'inventory_restored_count',  v_restored_count
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'refund_id', p_refund_id,
    'amount_minor', p_refund_amount_minor,
    'fulfillment_status_after', COALESCE(p_next_fulfillment, v_row.fulfillment_status),
    'inventory_restored_count', v_restored_count
  );
END;
$$;

COMMENT ON FUNCTION public.refund_order_atomic(uuid, uuid, text, integer, text, text, text, boolean, text, timestamptz) IS
'Atomically flips payment_status=refunded + optionally fulfillment_status + restores inventory + writes audit. Caller (JS) handles the external provider refund API call BEFORE invoking this — refund_id and amount_minor are inputs, not outputs.';

REVOKE EXECUTE ON FUNCTION public.refund_order_atomic(uuid, uuid, text, integer, text, text, text, boolean, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refund_order_atomic(uuid, uuid, text, integer, text, text, text, boolean, text, timestamptz)
  TO service_role;

NOTIFY pgrst, 'reload schema';
