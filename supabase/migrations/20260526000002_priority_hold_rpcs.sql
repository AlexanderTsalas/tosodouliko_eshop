-- =============================================================================
-- Phase 4A — Priority-hold RPCs + soft-wait queue advancement.
--
-- Bucket movements (all atomic single-row UPDATEs with predicates):
--   promote_to_priority(v, q):     quantity_available -= q, quantity_priority_held += q
--   release_priority(v, q):        quantity_priority_held -= q, quantity_available += q
--   consume_priority_to_soft(v,q): quantity_priority_held -= q, quantity_soft_held += q
--
-- The consume RPC is what bridges a customer's promoted priority_hold into
-- the standard checkout flow: when they click "Ολοκλήρωση παραγγελίας" with
-- a priority-held item in cart, startCheckoutSession converts via
-- consume_priority_to_soft instead of hold_soft (which would fail — the
-- inventory is in their priority bucket, not the available pool).
--
-- Queue mechanics (orchestration RPCs, not bucket movements):
--   advance_soft_wait_queue_for_session(session_id):
--       called when a soft session is released. For each variant the session
--       held, promotes the FIFO-first soft_wait for that variant to a
--       5-minute priority_hold. Multiple variants → multiple promotions per
--       call (one per variant), but only one customer per variant gets the
--       promotion at a time.
--
--   advance_soft_wait_queue_after_priority_expiry(priority_hold_id):
--       called by the priority-hold reaper when a soft_wait_promotion-source
--       hold expires. Finds the next pending soft_wait for the same variant
--       in the same parent session and promotes them.
--
--   collapse_soft_wait_queue_for_session(session_id):
--       called when a soft session transitions to 'hard' (Pay clicked).
--       Deletes all soft_waits for the session and removes the corresponding
--       cart_items from waiters' carts. The Phase 3 collapse modal is
--       triggered by Realtime in 4C; for 4A the items just disappear.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- promote_to_priority
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_to_priority(
  p_variant_id uuid,
  p_qty        integer
)
RETURNS public.inventory_items
LANGUAGE plpgsql
AS $$
DECLARE
  result public.inventory_items;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;

  UPDATE public.inventory_items
  SET quantity_available     = quantity_available     - p_qty,
      quantity_priority_held = quantity_priority_held + p_qty,
      updated_at             = now()
  WHERE variant_id = p_variant_id
    AND quantity_available >= p_qty
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_INVENTORY';
  END IF;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.promote_to_priority IS
  'Moves p_qty units from available to priority_held. Used when a soft_wait is promoted, or when a wishlist subscriber is notified of restock with the 30-min grace window.';

-- ---------------------------------------------------------------------------
-- release_priority
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_priority(
  p_variant_id uuid,
  p_qty        integer
)
RETURNS public.inventory_items
LANGUAGE plpgsql
AS $$
DECLARE
  result public.inventory_items;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;

  UPDATE public.inventory_items
  SET quantity_priority_held = quantity_priority_held - p_qty,
      quantity_available     = quantity_available     + p_qty,
      updated_at             = now()
  WHERE variant_id = p_variant_id
    AND quantity_priority_held >= p_qty
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_PRIORITY_HELD';
  END IF;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.release_priority IS
  'Moves p_qty units from priority_held back to available. Used when a priority hold expires unconsumed or is voluntarily released.';

-- ---------------------------------------------------------------------------
-- consume_priority_to_soft
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_priority_to_soft(
  p_variant_id uuid,
  p_qty        integer
)
RETURNS public.inventory_items
LANGUAGE plpgsql
AS $$
DECLARE
  result public.inventory_items;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;

  -- Bucket swap, available is unchanged. Same pattern as
  -- promote_soft_to_reserved.
  UPDATE public.inventory_items
  SET quantity_priority_held = quantity_priority_held - p_qty,
      quantity_soft_held     = quantity_soft_held     + p_qty,
      updated_at             = now()
  WHERE variant_id = p_variant_id
    AND quantity_priority_held >= p_qty
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_PRIORITY_HELD';
  END IF;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.consume_priority_to_soft IS
  'Atomically moves p_qty units from priority_held to soft_held. Called when a customer with a priority_hold clicks "Ολοκλήρωση παραγγελίας" — bridges the priority hold into the standard checkout flow without releasing inventory along the way.';

-- ---------------------------------------------------------------------------
-- advance_soft_wait_queue_for_session
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.advance_soft_wait_queue_for_session(
  p_session_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_promoted_count integer := 0;
  v_variant_id     uuid;
  v_first_wait     record;
  v_expires_at     timestamptz;
BEGIN
  -- For each variant that had a soft_wait under this session, find the
  -- FIFO-first pending waiter and promote. We loop over distinct variants
  -- so each gets at most one promotion per call.
  FOR v_variant_id IN
    SELECT DISTINCT variant_id
    FROM public.soft_waits
    WHERE checkout_session_id = p_session_id
      AND promoted_at IS NULL
  LOOP
    SELECT *
    INTO v_first_wait
    FROM public.soft_waits
    WHERE checkout_session_id = p_session_id
      AND variant_id = v_variant_id
      AND promoted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    BEGIN
      -- Try to grant the priority hold. If inventory has drifted (someone
      -- else got it via opportunistic cleanup, etc.) we just skip — the
      -- waiter stays in queue and will be retried next release event.
      PERFORM public.promote_to_priority(v_variant_id, v_first_wait.quantity);
    EXCEPTION WHEN OTHERS THEN
      -- INSUFFICIENT_INVENTORY is the expected miss; log others.
      IF SQLERRM NOT LIKE '%INSUFFICIENT_INVENTORY%' THEN
        RAISE NOTICE 'advance_soft_wait_queue_for_session: promote_to_priority failed for variant % qty %: %',
          v_variant_id, v_first_wait.quantity, SQLERRM;
      END IF;
      CONTINUE;
    END;

    v_expires_at := now() + interval '5 minutes';

    INSERT INTO public.priority_holds (
      variant_id, customer_id, quantity, source, expires_at, origin_soft_wait_id
    ) VALUES (
      v_variant_id, v_first_wait.customer_id, v_first_wait.quantity,
      'soft_wait_promotion', v_expires_at, v_first_wait.id
    );

    UPDATE public.soft_waits
    SET promoted_at = now()
    WHERE id = v_first_wait.id;

    v_promoted_count := v_promoted_count + 1;
  END LOOP;

  RETURN v_promoted_count;
END;
$$;

COMMENT ON FUNCTION public.advance_soft_wait_queue_for_session IS
  'For each variant held by the given session, promotes the FIFO-first pending soft_wait into a 5-minute priority_hold. Idempotent — callable multiple times safely. Returns the number of promotions made.';

-- ---------------------------------------------------------------------------
-- advance_soft_wait_queue_after_priority_expiry
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.advance_soft_wait_queue_after_priority_expiry(
  p_priority_hold_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hold        record;
  v_origin_wait record;
  v_next_wait   record;
BEGIN
  SELECT * INTO v_hold FROM public.priority_holds WHERE id = p_priority_hold_id;
  IF NOT FOUND OR v_hold.source <> 'soft_wait_promotion' THEN
    RETURN false;
  END IF;
  IF v_hold.origin_soft_wait_id IS NULL THEN
    RETURN false;
  END IF;

  -- Origin tells us which (checkout_session_id, variant_id) bucket the queue
  -- belongs to. The next-in-queue is the oldest still-pending row in that
  -- same bucket.
  SELECT * INTO v_origin_wait
  FROM public.soft_waits
  WHERE id = v_hold.origin_soft_wait_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT * INTO v_next_wait
  FROM public.soft_waits
  WHERE checkout_session_id = v_origin_wait.checkout_session_id
    AND variant_id = v_origin_wait.variant_id
    AND promoted_at IS NULL
  ORDER BY created_at ASC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  BEGIN
    PERFORM public.promote_to_priority(v_next_wait.variant_id, v_next_wait.quantity);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%INSUFFICIENT_INVENTORY%' THEN
      RAISE NOTICE 'advance_soft_wait_queue_after_priority_expiry: promote_to_priority failed: %', SQLERRM;
    END IF;
    RETURN false;
  END;

  INSERT INTO public.priority_holds (
    variant_id, customer_id, quantity, source, expires_at, origin_soft_wait_id
  ) VALUES (
    v_next_wait.variant_id, v_next_wait.customer_id, v_next_wait.quantity,
    'soft_wait_promotion', now() + interval '5 minutes', v_next_wait.id
  );

  UPDATE public.soft_waits SET promoted_at = now() WHERE id = v_next_wait.id;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.advance_soft_wait_queue_after_priority_expiry IS
  'Called by the priority-hold reaper when a soft_wait_promotion-source hold expires unconsumed. Promotes the next FIFO waiter in the same (session, variant) bucket to a fresh 5-minute priority_hold.';

-- ---------------------------------------------------------------------------
-- collapse_soft_wait_queue_for_session
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.collapse_soft_wait_queue_for_session(
  p_session_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_collapsed_count integer := 0;
  v_wait            record;
BEGIN
  -- For each (pending or already-promoted) waiter under this session,
  -- remove the corresponding cart_item from their cart and delete the
  -- soft_wait row. If the waiter had been promoted to a priority_hold and
  -- hasn't consumed it yet, release that hold too.
  FOR v_wait IN
    SELECT id, cart_item_id, variant_id, quantity, customer_id, promoted_at
    FROM public.soft_waits
    WHERE checkout_session_id = p_session_id
  LOOP
    IF v_wait.promoted_at IS NOT NULL THEN
      DECLARE
        v_hold record;
      BEGIN
        SELECT * INTO v_hold
        FROM public.priority_holds
        WHERE origin_soft_wait_id = v_wait.id
          AND consumed_at IS NULL;
        IF FOUND THEN
          BEGIN
            PERFORM public.release_priority(v_hold.variant_id, v_hold.quantity);
            UPDATE public.priority_holds
            SET expires_at = now(), consumed_at = now()
            WHERE id = v_hold.id;
          EXCEPTION WHEN OTHERS THEN
            IF SQLERRM NOT LIKE '%INSUFFICIENT_PRIORITY_HELD%' THEN
              RAISE NOTICE 'collapse_soft_wait_queue_for_session: release_priority failed: %', SQLERRM;
            END IF;
          END;
        END IF;
      END;
    END IF;

    DELETE FROM public.cart_items WHERE id = v_wait.cart_item_id;
    DELETE FROM public.soft_waits WHERE id = v_wait.id;
    v_collapsed_count := v_collapsed_count + 1;
  END LOOP;

  RETURN v_collapsed_count;
END;
$$;

COMMENT ON FUNCTION public.collapse_soft_wait_queue_for_session IS
  'Called when the soft session transitions to ''hard'' (Pay clicked). Removes the contested cart_items from waiters'' carts, releases any in-flight priority_holds, and deletes the soft_wait rows. Phase 4C will Realtime-broadcast the collapse modal trigger to affected customers.';
