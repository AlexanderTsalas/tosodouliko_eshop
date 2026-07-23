-- =============================================================================
-- release_soft_session(session_id): explicit user-initiated release for a
-- specific soft session.
--
-- Used by the client-initiated unload beacon (POST /api/checkout/release) that
-- fires from a `pagehide` listener on the checkout page when the customer
-- closes the tab or navigates away. The reaper and opportunistic cleanup will
-- both catch the abandonment eventually, but firing this RPC instantly frees
-- the inventory for the next customer in the contention queue.
--
-- Idempotent: a session that's already in a terminal state (released, hard,
-- completed) returns false and does nothing.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.release_soft_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session record;
  v_item record;
BEGIN
  SELECT id, cart_id, state
  INTO v_session
  FROM public.cart_checkout_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Only soft sessions can be released this way. 'hard' means placeOrder has
  -- already promoted to a reservation (those release via release_reservation
  -- on payment failure/expiry instead). 'completed' / 'released' are terminal.
  IF v_session.state <> 'soft' THEN
    RETURN false;
  END IF;

  IF v_session.cart_id IS NOT NULL THEN
    FOR v_item IN
      SELECT variant_id, quantity
      FROM public.cart_items
      WHERE cart_id = v_session.cart_id
        AND variant_id IS NOT NULL
        AND quantity > 0
    LOOP
      BEGIN
        PERFORM public.release_soft(v_item.variant_id, v_item.quantity);
      EXCEPTION WHEN OTHERS THEN
        -- INSUFFICIENT_SOFT_HELD is benign (already released by another path).
        IF SQLERRM NOT LIKE '%INSUFFICIENT_SOFT_HELD%' THEN
          RAISE NOTICE 'release_soft_session: release_soft failed for variant % qty %: %',
            v_item.variant_id, v_item.quantity, SQLERRM;
        END IF;
      END;
    END LOOP;
  END IF;

  UPDATE public.cart_checkout_sessions
  SET state = 'released', updated_at = now()
  WHERE id = p_session_id
    AND state = 'soft';

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.release_soft_session IS
  'Explicit release of a single soft session: releases every cart_item''s soft hold and marks the session ''released''. Called from the unload-beacon endpoint when the customer closes the checkout tab. Idempotent — non-soft sessions return false.';
