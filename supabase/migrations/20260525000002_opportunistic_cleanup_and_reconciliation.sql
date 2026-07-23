-- =============================================================================
-- Opportunistic cleanup + orphan reconciliation for soft-contention holds.
--
-- Background (read top to bottom):
--   1. hold_soft / release_soft / promote_soft_to_reserved keep the bucket
--      math correct. quantity_soft_held only grows or shrinks via these RPCs.
--   2. cart_checkout_sessions tracks the *intent* side: each row corresponds
--      to a wall-clock window during which a customer's soft hold is alive.
--   3. The periodic reap_stale_soft_sessions() job (every minute) closes the
--      gap between the wall-clock expiring and the bucket being returned.
--
-- Two residual problems this migration solves:
--
-- (A) Contested-click latency.  Between a session's expires_at and the next
--     reap tick (up to ~60s), a competing customer who clicks "Ολοκλήρωση
--     παραγγελίας" will see stale contention (the soft_held bucket still
--     reflects the dead session). The fix is *opportunistic cleanup*: every
--     time we are about to operate on contention state for a specific
--     variant (hold_soft, effective_available_for), we first inline-release
--     any expired sessions that touch that variant. The work is bounded
--     (single variant, small N) and only paid when someone actually
--     contends — the cron job remains the lower-bound guarantee for the
--     idle case.
--
-- (B) Orphan soft_held counters.  Historically, if an admin edited inventory
--     via the CMS while a soft hold was alive, or if a session crashed mid-
--     write, quantity_soft_held could end up greater than the sum of live
--     session holds. The reaper can't fix this — it only looks at sessions
--     it can see. reconcile_orphan_soft_held() periodically computes the
--     correct soft_held value from live cart_items + active sessions and
--     moves the difference back into quantity_available.
--
-- Both functions are idempotent and safe to run concurrently with the
-- regular hold_soft / release_soft / promote_soft_to_reserved RPCs.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: release all expired soft sessions that touch this variant.
--
-- Called inline from hold_soft / effective_available_for so contested
-- callers don't have to wait for the cron tick. Returns the number of
-- sessions released (mostly for diagnostics; callers ignore it).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions_for_variant(
  p_variant_id uuid
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_released_count integer := 0;
  v_session record;
  v_item record;
BEGIN
  IF p_variant_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_session IN
    SELECT s.id, s.cart_id
    FROM public.cart_checkout_sessions s
    WHERE s.state = 'soft'
      AND s.expires_at < now()
      AND s.cart_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.cart_items ci
        WHERE ci.cart_id = s.cart_id
          AND ci.variant_id = p_variant_id
          AND ci.quantity > 0
      )
  LOOP
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
        -- INSUFFICIENT_SOFT_HELD is benign here: the hold for this item was
        -- already released by another path. Log everything else so it shows
        -- up in postgres logs.
        IF SQLERRM NOT LIKE '%INSUFFICIENT_SOFT_HELD%' THEN
          RAISE NOTICE 'cleanup_expired_sessions_for_variant: release_soft failed for variant % qty %: %',
            v_item.variant_id, v_item.quantity, SQLERRM;
        END IF;
      END;
    END LOOP;

    UPDATE public.cart_checkout_sessions
    SET state = 'released', updated_at = now()
    WHERE id = v_session.id;

    v_released_count := v_released_count + 1;
  END LOOP;

  RETURN v_released_count;
END;
$$;

COMMENT ON FUNCTION public.cleanup_expired_sessions_for_variant IS
  'Inline cleanup helper: releases any expired soft sessions that hold this variant, then marks them released. Called from hold_soft / effective_available_for so contested customers don''t see stale contention during the gap between expires_at and the next reaper tick.';

-- ---------------------------------------------------------------------------
-- hold_soft: same semantics as before, with a cleanup pass for the target
-- variant up front. The cleanup is best-effort — if it fails, we still
-- attempt the hold (the original UPDATE has its own guard).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hold_soft(p_variant_id uuid, p_qty integer)
RETURNS public.inventory_items
LANGUAGE plpgsql
AS $$
DECLARE
  result public.inventory_items;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;

  -- Opportunistic: release any expired sessions touching this variant
  -- before we evaluate availability. Eliminates the contested-click gap
  -- between session expiry and the next cron tick.
  BEGIN
    PERFORM public.cleanup_expired_sessions_for_variant(p_variant_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'hold_soft: opportunistic cleanup failed for variant %: %',
      p_variant_id, SQLERRM;
  END;

  UPDATE public.inventory_items
  SET quantity_available = quantity_available - p_qty,
      quantity_soft_held = quantity_soft_held + p_qty,
      updated_at         = now()
  WHERE variant_id = p_variant_id
    AND quantity_available >= p_qty
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_INVENTORY';
  END IF;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.hold_soft IS
  'Atomically moves p_qty units from available to soft_held. Runs opportunistic cleanup of expired sessions for this variant first so contested callers don''t see stale soft_held. Raises INSUFFICIENT_INVENTORY if quantity_available < p_qty after cleanup.';

-- ---------------------------------------------------------------------------
-- effective_available_for: cleanup first, then read. STABLE was a small
-- white lie even before this change (we already read mutable state); now
-- the cleanup writes too, so we drop STABLE entirely.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.effective_available_for(
  p_variant_id uuid,
  p_viewer_id  uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_result integer;
BEGIN
  BEGIN
    PERFORM public.cleanup_expired_sessions_for_variant(p_variant_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'effective_available_for: opportunistic cleanup failed for variant %: %',
      p_variant_id, SQLERRM;
  END;

  SELECT GREATEST(quantity_available, 0)
  INTO v_result
  FROM public.inventory_items
  WHERE variant_id = p_variant_id;

  -- TODO Phase 4: add back the viewer's own hold contributions so a
  -- customer who is the one holding the units doesn't see "out of stock"
  -- on their own product page in a second tab.

  RETURN COALESCE(v_result, 0);
END;
$$;

COMMENT ON FUNCTION public.effective_available_for IS
  'Per-viewer effective availability. Runs opportunistic cleanup of expired sessions for this variant before reading quantity_available so product-page CTAs reflect freshly-released stock instantly. Viewer parameter retained for Phase 4 self-contention subtraction.';

-- ---------------------------------------------------------------------------
-- Orphan reconciliation. Scans inventory_items where quantity_soft_held > 0
-- and computes the *correct* soft_held from live (state IN ('soft','hard'))
-- sessions joined to their cart items. The difference is the orphan, which
-- we move back into quantity_available. Wrapped in a per-row transaction so
-- one drifted variant doesn't abort the whole sweep.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_orphan_soft_held()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fixed_count integer := 0;
  v_row record;
  v_expected integer;
  v_orphan integer;
BEGIN
  FOR v_row IN
    SELECT variant_id, quantity_soft_held
    FROM public.inventory_items
    WHERE quantity_soft_held > 0
  LOOP
    -- Sum of live (soft + hard) session holds for this variant.
    SELECT COALESCE(SUM(ci.quantity), 0)
    INTO v_expected
    FROM public.cart_checkout_sessions s
    JOIN public.cart_items ci ON ci.cart_id = s.cart_id
    WHERE s.state IN ('soft', 'hard')
      AND ci.variant_id = v_row.variant_id
      AND ci.quantity > 0;

    v_orphan := v_row.quantity_soft_held - v_expected;

    IF v_orphan > 0 THEN
      BEGIN
        UPDATE public.inventory_items
        SET quantity_soft_held = quantity_soft_held - v_orphan,
            quantity_available = quantity_available + v_orphan,
            updated_at         = now()
        WHERE variant_id = v_row.variant_id
          AND quantity_soft_held >= v_orphan;

        IF FOUND THEN
          v_fixed_count := v_fixed_count + 1;
          RAISE NOTICE 'reconcile_orphan_soft_held: variant % reclaimed % orphan unit(s)',
            v_row.variant_id, v_orphan;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'reconcile_orphan_soft_held: failed to reconcile variant %: %',
          v_row.variant_id, SQLERRM;
      END;
    END IF;
  END LOOP;

  RETURN v_fixed_count;
END;
$$;

COMMENT ON FUNCTION public.reconcile_orphan_soft_held IS
  'Periodic sweep: for each variant with quantity_soft_held > 0, computes the expected value from live cart_checkout_sessions (state in soft/hard) joined to cart_items, and moves any excess back into quantity_available. Catches drift from CMS edits during active holds or crashed writes. Scheduled every 5 minutes via pg_cron when available.';

-- ---------------------------------------------------------------------------
-- Schedule the reconciliation. Wrapped in DO/EXCEPTION so the migration
-- survives projects without pg_cron — the function remains callable manually
-- via:  SELECT public.reconcile_orphan_soft_held();
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('reconcile-orphan-soft-held');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'reconcile-orphan-soft-held',
    '*/5 * * * *',
    'SELECT public.reconcile_orphan_soft_held()'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE
    'pg_cron scheduling failed: %. reconcile_orphan_soft_held() is still callable manually.',
    SQLERRM;
END $$;
