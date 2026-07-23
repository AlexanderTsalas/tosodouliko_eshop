-- =============================================================================
-- Phase 8d — Set-based DELETEs in collapse_soft_wait_queue_for_session.
--
-- Background:
--   The legacy collapse function loops over soft_waits row-by-row, doing
--   `DELETE FROM cart_items WHERE id = X` then `DELETE FROM soft_waits
--   WHERE id = X` per waiter. For a session with N waiters this is
--   2N DELETE round-trips inside the transaction. Cron-driven so
--   not user-blocking on the firing path, but at any inventory backlog
--   the inner loop scales O(N).
--
--   This rewrite:
--     - Keeps the per-waiter priority_hold release loop (each call needs
--       individual error handling for the drift race), but switches its
--       EXCEPTION pattern to typed SQLSTATE 'IPRIO' catch (Phase 8a's
--       custom code), with non-benign errors logged to system_errors.
--     - Replaces the per-row DELETE FROM cart_items with one set-based
--       DELETE using `id IN (SELECT cart_item_id FROM soft_waits WHERE
--       checkout_session_id = $1)`.
--     - Replaces the per-row DELETE FROM soft_waits with one set-based
--       DELETE WHERE checkout_session_id = $1.
--
--   At a session with 10 waiters: 20 DELETE round-trips → 2.
-- =============================================================================

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
  v_promoted_hold   record;
BEGIN
  -- 1. Release any active priority_holds owned by promoted waiters in
  --    this session. The release_priority call must be per-row because
  --    each affects a specific (variant_id, qty) bucket — clamping or
  --    set-based aggregate logic is fragile under the drift race. We
  --    DO upgrade the exception catch to typed SQLSTATE so non-benign
  --    errors are visible via /admin/system-errors.
  FOR v_promoted_hold IN
    SELECT ph.id, ph.variant_id, ph.quantity
    FROM public.priority_holds ph
    JOIN public.soft_waits sw ON sw.id = ph.origin_soft_wait_id
    WHERE sw.checkout_session_id = p_session_id
      AND sw.promoted_at IS NOT NULL
      AND ph.consumed_at IS NULL
  LOOP
    BEGIN
      PERFORM public.release_priority(
        v_promoted_hold.variant_id,
        v_promoted_hold.quantity
      );
      UPDATE public.priority_holds
      SET expires_at = now(), consumed_at = now()
      WHERE id = v_promoted_hold.id;
    EXCEPTION
      WHEN SQLSTATE 'IPRIO' THEN
        -- Benign: bucket already drained by another path. Still mark
        -- the priority_hold as consumed so it doesn't reappear in the
        -- next reaper tick.
        UPDATE public.priority_holds
        SET expires_at = now(), consumed_at = now()
        WHERE id = v_promoted_hold.id;
      WHEN OTHERS THEN
        PERFORM public.log_system_error(
          'collapse_soft_wait_queue_for_session.release_priority',
          'error',
          SQLSTATE,
          SQLERRM,
          'variant',
          v_promoted_hold.variant_id,
          jsonb_build_object(
            'session_id',       p_session_id,
            'priority_hold_id', v_promoted_hold.id,
            'qty',              v_promoted_hold.quantity
          )
        );
    END;
  END LOOP;

  -- 2. Set-based DELETE: every cart_item referenced by a soft_wait for
  --    this session goes in one statement. Replaces N per-row DELETEs.
  --    Capture the row count for the return value.
  WITH deleted_items AS (
    DELETE FROM public.cart_items
    WHERE id IN (
      SELECT cart_item_id
      FROM public.soft_waits
      WHERE checkout_session_id = p_session_id
    )
    RETURNING id
  )
  SELECT count(*) INTO v_collapsed_count FROM deleted_items;

  -- 3. Set-based DELETE: clean out the soft_wait rows themselves.
  DELETE FROM public.soft_waits WHERE checkout_session_id = p_session_id;

  RETURN v_collapsed_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.collapse_soft_wait_queue_for_session(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.collapse_soft_wait_queue_for_session(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
