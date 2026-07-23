-- =============================================================================
-- Batch priority-hold consumption for checkout session start.
--
-- Replaces the N-iteration loop in startCheckoutSession.ts that makes 2-3
-- queries per cart item (select hold → consume_priority_to_soft RPC → update
-- hold). For a cart with 5 items, that's 10-15 round-trips. This function
-- does the same work in a single DB call.
--
-- For each (customer, variant, quantity) triple, finds an active priority
-- hold with sufficient quantity, consumes it (moves inventory from
-- priority_held to soft_held), and marks the hold row consumed. Returns
-- the set of variant_ids that were successfully consumed so the caller
-- knows which lines still need regular hold_soft.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.consume_priority_holds_for_checkout(
  p_customer_id uuid,
  p_variant_ids uuid[],
  p_quantities int[]
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_consumed uuid[] := ARRAY[]::uuid[];
  v_idx int;
  v_variant_id uuid;
  v_qty int;
  v_hold record;
BEGIN
  IF array_length(p_variant_ids, 1) IS NULL THEN
    RETURN v_consumed;
  END IF;

  FOR v_idx IN 1..array_length(p_variant_ids, 1) LOOP
    v_variant_id := p_variant_ids[v_idx];
    v_qty := p_quantities[v_idx];

    -- Find the best matching hold: active, sufficient quantity, earliest expiry.
    SELECT id, quantity INTO v_hold
    FROM public.priority_holds
    WHERE customer_id = p_customer_id
      AND variant_id = v_variant_id
      AND consumed_at IS NULL
      AND expires_at > now()
      AND quantity >= v_qty
    ORDER BY expires_at ASC
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Atomic bucket move: priority_held → soft_held.
    BEGIN
      PERFORM public.consume_priority_to_soft(v_variant_id, v_qty);
    EXCEPTION WHEN OTHERS THEN
      -- Race lost (hold already consumed by another path). Skip this line;
      -- it'll fall through to regular hold_soft in the caller.
      CONTINUE;
    END;

    -- Mark the hold consumed.
    UPDATE public.priority_holds
    SET consumed_at = now()
    WHERE id = v_hold.id;

    v_consumed := array_append(v_consumed, v_variant_id);
  END LOOP;

  RETURN v_consumed;
END;
$$;

COMMENT ON FUNCTION public.consume_priority_holds_for_checkout IS
  'Batch consumes priority holds into soft holds for a checkout session start. Returns the array of variant_ids that were successfully consumed. Lines not consumed fall through to regular hold_soft in the caller.';

GRANT EXECUTE ON FUNCTION public.consume_priority_holds_for_checkout(uuid, uuid[], int[]) TO authenticated, service_role;
