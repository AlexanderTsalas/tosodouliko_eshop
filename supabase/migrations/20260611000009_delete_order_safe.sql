-- =============================================================================
-- Phase 3c — delete_order_safe.
--
-- Background:
--   The legacy deleteOrder.ts does a per-item release/restore loop
--   with a fallback-then-fallback pattern: release_reservation first,
--   then on INSUFFICIENT_RESERVED fall back to restore_inventory
--   (flagged as "drift"), otherwise refuse the whole delete.
--
--   If item 4 of 6 fails for some reason OTHER than insufficient-
--   reserved, items 1-3 are already released and items 5-6 are not;
--   the order still exists. This RPC compresses the whole sequence
--   into a single transaction so partial state is impossible.
--
--   Safety gate validation (refuse paid-Stripe-not-refunded, refuse
--   shipped-not-refunded) stays in the JS wrapper so user-facing error
--   messages can be Greek. The RPC trusts the caller to have validated
--   gates — but defense-in-depth IDEMPOTENCY checks live here too:
--   the function refuses to delete a non-existent order and refuses
--   to RAISE for unexpected payment_method values.
--
--   Inventory-effect computation is inlined as CASE expressions
--   mirroring hasInventoryEffect / isReservationConsumed (src/types/
--   order-history.ts). Logic kept compact so future changes update
--   both places in lockstep.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.delete_order_safe(
  p_order_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row        public.orders%ROWTYPE;
  v_item       record;
  v_had_effect boolean;
  v_consumed   boolean;
  v_action     text := 'none';  -- 'released' | 'restored' | 'released_with_drift' | 'none'
  v_drift      jsonb[] := ARRAY[]::jsonb[];
BEGIN
  -- Load + validate existence
  SELECT * INTO v_row FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ORDER_NOT_FOUND';
  END IF;

  -- hasInventoryEffect logic
  v_had_effect := v_row.fulfillment_status NOT IN ('draft', 'cancelled');

  -- isReservationConsumed logic
  v_consumed := CASE
    WHEN v_row.fulfillment_status IN ('draft', 'cancelled') THEN false
    WHEN v_row.payment_method = 'stripe' THEN v_row.payment_status = 'paid'
    ELSE v_row.fulfillment_status IN ('delivered', 'picked_up')
         AND v_row.payment_status = 'paid'
  END;

  -- Inventory reversal — same branching as the JS path but in one
  -- transaction.  If anything fails non-idempotently, the txn rolls
  -- back including the order DELETE below.
  IF v_had_effect AND NOT v_consumed THEN
    -- Pre-consumption: release reservations. Per-item loop because
    -- we need to detect INSUFFICIENT_RESERVED per row and fall back
    -- to restore_inventory for drifted rows.
    v_action := CASE WHEN v_row.payment_method = 'stripe' THEN 'restored' ELSE 'released' END;

    FOR v_item IN
      SELECT variant_id, quantity
        FROM public.order_items
       WHERE order_id = p_order_id AND variant_id IS NOT NULL
    LOOP
      IF v_row.payment_method = 'stripe' THEN
        -- Stripe pre-payment edge: decremented stock, restore it.
        UPDATE public.inventory_items
           SET quantity_available = quantity_available + v_item.quantity,
               updated_at = now()
         WHERE variant_id = v_item.variant_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = format('INVENTORY_NOT_FOUND for variant %s during restore', v_item.variant_id);
        END IF;
      ELSE
        -- Non-Stripe: release reservation. On INSUFFICIENT_RESERVED
        -- (drift caused by hand-edits to the Held cell), fall back
        -- to restore_inventory and flag it as drift.
        UPDATE public.inventory_items
           SET quantity_available = quantity_available + v_item.quantity,
               quantity_reserved  = quantity_reserved  - v_item.quantity,
               updated_at = now()
         WHERE variant_id = v_item.variant_id
           AND quantity_reserved >= v_item.quantity;

        IF NOT FOUND THEN
          -- Drift recovery: just put the units back to available.
          -- Same intent as the JS fallback path.
          UPDATE public.inventory_items
             SET quantity_available = quantity_available + v_item.quantity,
                 updated_at = now()
           WHERE variant_id = v_item.variant_id;
          IF NOT FOUND THEN
            RAISE EXCEPTION USING
              ERRCODE = '22023',
              MESSAGE = format('INVENTORY_NOT_FOUND for variant %s during release+restore fallback', v_item.variant_id);
          END IF;
          v_drift := v_drift || jsonb_build_object(
            'variant_id', v_item.variant_id,
            'qty', v_item.quantity
          );
        END IF;
      END IF;
    END LOOP;

    IF cardinality(v_drift) > 0 THEN
      v_action := 'released_with_drift';
    END IF;
  END IF;

  -- Audit log BEFORE the delete — needs the order_number which we
  -- already loaded. order_items cascade-delete with the orders row
  -- so we can't reference them later.
  INSERT INTO public.audit_events (
    actor_id, actor_type, action, resource_type, resource_id, metadata
  )
  VALUES (
    p_actor_id,
    'user',
    'order.deleted',
    'order',
    p_order_id::text,
    jsonb_build_object(
      'order_number',                    v_row.order_number,
      'payment_method',                  v_row.payment_method,
      'payment_status_at_delete',        v_row.payment_status,
      'fulfillment_status_at_delete',    v_row.fulfillment_status,
      'total',                           v_row.total,
      'inventory_action',                v_action,
      'inventory_drift',                 CASE WHEN cardinality(v_drift) > 0 THEN to_jsonb(v_drift) ELSE NULL END
    )
  );

  -- The actual DELETE. order_items CASCADE.
  DELETE FROM public.orders WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'order_number', v_row.order_number,
    'inventory_action', v_action,
    'drift', CASE WHEN cardinality(v_drift) > 0 THEN to_jsonb(v_drift) ELSE NULL END
  );
END;
$$;

COMMENT ON FUNCTION public.delete_order_safe(uuid, uuid) IS
'Atomically reverses inventory + audits + deletes an order. Trusts caller to have validated safety gates (paid-Stripe-not-refunded, shipped-not-refunded). Returns inventory_action verdict and optional drift list.';

REVOKE EXECUTE ON FUNCTION public.delete_order_safe(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.delete_order_safe(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
