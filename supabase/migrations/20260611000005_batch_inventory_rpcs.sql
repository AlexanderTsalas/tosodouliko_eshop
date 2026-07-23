-- =============================================================================
-- Phase 2a — Batch inventory RPCs.
--
-- Background:
--   Today every multi-line cart action (hold_soft, reserve, promote,
--   release, restore) makes ONE Postgres RPC per cart line, sequentially
--   from JS, with a hand-rolled "rollback in reverse on failure" loop.
--   A 5-item cart placement is ~15 RPCs (5 hold, 5 promote, 5 reserve)
--   plus up to 15 more on partial failure. Each round-trip through
--   Supabase's HTTP layer is ~30-50ms — net ~450-750ms just on
--   inventory, with the rollback-on-failure path being fragile (a
--   network hiccup during rollback leaves drift).
--
--   Six new SECURITY DEFINER functions accept a jsonb array of
--   {variant_id, qty} lines and process them all inside one PL/pgSQL
--   transaction. Any failure raises and the whole batch rolls back —
--   the JS-layer compensating-rollback pattern is gone for these paths.
--
--   The legacy per-row primitives (hold_soft, release_soft,
--   reserve_inventory, etc.) stay in place, untouched. Callers are
--   migrated one at a time. After every caller is on the batch path,
--   a future cleanup phase may drop the per-row RPCs.
--
--   The batch RPCs raise with the custom SQLSTATE codes reserved in
--   migration 20260611000004 ('IINVT', 'ISFTL', 'IRSRV', 'INVQT').
--   Callers check error.code to distinguish failure modes — more
--   reliable than the legacy string-match-on-message pattern.
--
-- Input contract:
--   p_lines: jsonb array of {variant_id: uuid, qty: int}
--     - Empty array → no-op, returns {ok: true, processed: 0}
--     - Non-array or NULL → raises INVQT
--     - Each line individually validated (qty > 0)
--
-- Output contract:
--   On success: jsonb {ok: true, processed: N}
--   On failure: function RAISES with USING ERRCODE = '<code>',
--               MESSAGE includes the failed line's variant_id + qty +
--               index — the function does NOT return a failure
--               envelope, it RAISES (so the txn rolls back).
--
-- SQLSTATE codes used:
--   INVQT — INVALID_QUANTITY     (qty <= 0 or bad input shape)
--   IINVT — INSUFFICIENT_INVENTORY  (hold_soft_batch, reserve_inventory_batch)
--   ISFTL — INSUFFICIENT_SOFT_HELD  (release_soft_batch, promote_soft_to_reserved_batch)
--   IRSRV — INSUFFICIENT_RESERVED   (release_reservation_batch)
--   (restore_inventory_batch raises P0001 'INVENTORY_NOT_FOUND' — same
--    legacy code as restore_inventory, no insufficient-quantity check.)
-- =============================================================================

-- ──── hold_soft_batch ────────────────────────────────────────────────────────
-- Atomic soft-hold for N lines. Used at "Ολοκλήρωση παραγγελίας" click
-- to engage Phase 2 soft contention for the customer's entire cart.
-- The opportunistic cleanup that the per-row hold_soft does is folded
-- into a single pre-pass over all variants in the batch.
CREATE OR REPLACE FUNCTION public.hold_soft_batch(p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line       jsonb;
  v_variant_id uuid;
  v_qty        integer;
  v_processed  integer := 0;
  v_count      integer;
  v_variant_ids uuid[];
BEGIN
  -- Input shape validation
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'INVQT',
      MESSAGE = 'INVALID_QUANTITY: p_lines must be a non-null jsonb array';
  END IF;
  v_count := jsonb_array_length(p_lines);
  IF v_count = 0 THEN
    RETURN jsonb_build_object('ok', true, 'processed', 0);
  END IF;

  -- Opportunistic cleanup pass: one cleanup call per distinct variant
  -- BEFORE the hold loop. Mirrors per-row hold_soft semantics but
  -- amortized over the batch.
  SELECT array_agg(DISTINCT (l ->> 'variant_id')::uuid)
    INTO v_variant_ids
    FROM jsonb_array_elements(p_lines) AS l;

  IF v_variant_ids IS NOT NULL THEN
    FOR v_variant_id IN SELECT unnest(v_variant_ids) LOOP
      BEGIN
        PERFORM public.cleanup_expired_sessions_for_variant(v_variant_id);
      EXCEPTION WHEN OTHERS THEN
        -- Cleanup failure must not abort the hold attempt — the reaper
        -- cron will catch up. Phase 8 will route this to log_system_error
        -- once typed catches land.
        RAISE NOTICE 'hold_soft_batch: opportunistic cleanup failed for variant %: %',
          v_variant_id, SQLERRM;
      END;
    END LOOP;
  END IF;

  -- Process each line. Single transaction — any RAISE rolls back the
  -- whole batch including any earlier successful holds in this same
  -- function call. No JS-layer rollback needed.
  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    v_variant_id := (v_line ->> 'variant_id')::uuid;
    v_qty        := (v_line ->> 'qty')::integer;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'INVQT',
        MESSAGE = format(
          'INVALID_QUANTITY: qty=%s for variant %s at index %s',
          v_qty, v_variant_id, v_processed
        );
    END IF;

    UPDATE public.inventory_items
       SET quantity_available = quantity_available - v_qty,
           quantity_soft_held = quantity_soft_held + v_qty,
           updated_at         = now()
     WHERE variant_id = v_variant_id
       AND quantity_available >= v_qty;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'IINVT',
        MESSAGE = format(
          'INSUFFICIENT_INVENTORY for variant %s (requested %s) at index %s',
          v_variant_id, v_qty, v_processed
        );
    END IF;

    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'processed', v_processed);
END;
$$;

COMMENT ON FUNCTION public.hold_soft_batch(jsonb) IS
'Atomic batch soft-hold. Input: jsonb array of {variant_id, qty}. All lines succeed or all roll back. Raises SQLSTATE INVQT or IINVT with the failed index in the message.';

REVOKE EXECUTE ON FUNCTION public.hold_soft_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hold_soft_batch(jsonb) TO service_role;

-- ──── release_soft_batch ─────────────────────────────────────────────────────
-- Atomic batch release of soft-holds. Used by failure-path cleanup
-- (e.g. when downstream order insert fails after a successful hold).
-- No opportunistic cleanup — releases don't need a fresh availability
-- read.
CREATE OR REPLACE FUNCTION public.release_soft_batch(p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line       jsonb;
  v_variant_id uuid;
  v_qty        integer;
  v_processed  integer := 0;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'INVQT',
      MESSAGE = 'INVALID_QUANTITY: p_lines must be a non-null jsonb array';
  END IF;
  IF jsonb_array_length(p_lines) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'processed', 0);
  END IF;

  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    v_variant_id := (v_line ->> 'variant_id')::uuid;
    v_qty        := (v_line ->> 'qty')::integer;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'INVQT',
        MESSAGE = format('INVALID_QUANTITY: qty=%s for variant %s at index %s',
          v_qty, v_variant_id, v_processed);
    END IF;

    UPDATE public.inventory_items
       SET quantity_available = quantity_available + v_qty,
           quantity_soft_held = quantity_soft_held - v_qty,
           updated_at         = now()
     WHERE variant_id = v_variant_id
       AND quantity_soft_held >= v_qty;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'ISFTL',
        MESSAGE = format(
          'INSUFFICIENT_SOFT_HELD for variant %s (requested %s) at index %s',
          v_variant_id, v_qty, v_processed
        );
    END IF;

    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'processed', v_processed);
END;
$$;

COMMENT ON FUNCTION public.release_soft_batch(jsonb) IS
'Atomic batch release of soft-holds. Raises SQLSTATE INVQT or ISFTL on failure.';

REVOKE EXECUTE ON FUNCTION public.release_soft_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_soft_batch(jsonb) TO service_role;

-- ──── reserve_inventory_batch ────────────────────────────────────────────────
-- Atomic batch hard-reservation. Used at order placement to swing
-- available→reserved for every line in one transaction. Replaces the
-- per-line reserve_inventory loop in reserveAllOrFail.
CREATE OR REPLACE FUNCTION public.reserve_inventory_batch(p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line       jsonb;
  v_variant_id uuid;
  v_qty        integer;
  v_processed  integer := 0;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'INVQT',
      MESSAGE = 'INVALID_QUANTITY: p_lines must be a non-null jsonb array';
  END IF;
  IF jsonb_array_length(p_lines) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'processed', 0);
  END IF;

  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    v_variant_id := (v_line ->> 'variant_id')::uuid;
    v_qty        := (v_line ->> 'qty')::integer;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'INVQT',
        MESSAGE = format('INVALID_QUANTITY: qty=%s for variant %s at index %s',
          v_qty, v_variant_id, v_processed);
    END IF;

    UPDATE public.inventory_items
       SET quantity_available = quantity_available - v_qty,
           quantity_reserved  = quantity_reserved  + v_qty,
           updated_at         = now()
     WHERE variant_id = v_variant_id
       AND quantity_available >= v_qty;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'IINVT',
        MESSAGE = format(
          'INSUFFICIENT_INVENTORY for variant %s (requested %s) at index %s',
          v_variant_id, v_qty, v_processed
        );
    END IF;

    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'processed', v_processed);
END;
$$;

COMMENT ON FUNCTION public.reserve_inventory_batch(jsonb) IS
'Atomic batch hard-reservation. Raises SQLSTATE INVQT or IINVT on failure.';

REVOKE EXECUTE ON FUNCTION public.reserve_inventory_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_inventory_batch(jsonb) TO service_role;

-- ──── release_reservation_batch ──────────────────────────────────────────────
-- Atomic batch undo of reservations. Used on cancellation paths +
-- as the rollback path when downstream order steps fail after a
-- successful reserve_inventory_batch.
CREATE OR REPLACE FUNCTION public.release_reservation_batch(p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line       jsonb;
  v_variant_id uuid;
  v_qty        integer;
  v_processed  integer := 0;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'INVQT',
      MESSAGE = 'INVALID_QUANTITY: p_lines must be a non-null jsonb array';
  END IF;
  IF jsonb_array_length(p_lines) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'processed', 0);
  END IF;

  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    v_variant_id := (v_line ->> 'variant_id')::uuid;
    v_qty        := (v_line ->> 'qty')::integer;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'INVQT',
        MESSAGE = format('INVALID_QUANTITY: qty=%s for variant %s at index %s',
          v_qty, v_variant_id, v_processed);
    END IF;

    UPDATE public.inventory_items
       SET quantity_available = quantity_available + v_qty,
           quantity_reserved  = quantity_reserved  - v_qty,
           updated_at         = now()
     WHERE variant_id = v_variant_id
       AND quantity_reserved >= v_qty;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'IRSRV',
        MESSAGE = format(
          'INSUFFICIENT_RESERVED for variant %s (requested %s) at index %s',
          v_variant_id, v_qty, v_processed
        );
    END IF;

    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'processed', v_processed);
END;
$$;

COMMENT ON FUNCTION public.release_reservation_batch(jsonb) IS
'Atomic batch release of hard reservations. Raises SQLSTATE INVQT or IRSRV on failure.';

REVOKE EXECUTE ON FUNCTION public.release_reservation_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_reservation_batch(jsonb) TO service_role;

-- ──── promote_soft_to_reserved_batch ─────────────────────────────────────────
-- Atomic batch swing of soft_held → reserved. Used by placeOrder when
-- the customer commits to payment — the soft holds already exist in
-- quantity_soft_held from the session; this transitions them all.
CREATE OR REPLACE FUNCTION public.promote_soft_to_reserved_batch(p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line       jsonb;
  v_variant_id uuid;
  v_qty        integer;
  v_processed  integer := 0;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'INVQT',
      MESSAGE = 'INVALID_QUANTITY: p_lines must be a non-null jsonb array';
  END IF;
  IF jsonb_array_length(p_lines) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'processed', 0);
  END IF;

  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    v_variant_id := (v_line ->> 'variant_id')::uuid;
    v_qty        := (v_line ->> 'qty')::integer;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'INVQT',
        MESSAGE = format('INVALID_QUANTITY: qty=%s for variant %s at index %s',
          v_qty, v_variant_id, v_processed);
    END IF;

    UPDATE public.inventory_items
       SET quantity_soft_held = quantity_soft_held - v_qty,
           quantity_reserved  = quantity_reserved  + v_qty,
           updated_at         = now()
     WHERE variant_id = v_variant_id
       AND quantity_soft_held >= v_qty;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'ISFTL',
        MESSAGE = format(
          'INSUFFICIENT_SOFT_HELD for variant %s (requested %s) at index %s',
          v_variant_id, v_qty, v_processed
        );
    END IF;

    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'processed', v_processed);
END;
$$;

COMMENT ON FUNCTION public.promote_soft_to_reserved_batch(jsonb) IS
'Atomic batch promotion of soft holds to reservations. Raises SQLSTATE INVQT or ISFTL on failure.';

REVOKE EXECUTE ON FUNCTION public.promote_soft_to_reserved_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_soft_to_reserved_batch(jsonb) TO service_role;

-- ──── restore_inventory_batch ────────────────────────────────────────────────
-- Atomic batch restore. No insufficient-quantity check (additive
-- only). Raises only if a variant_id doesn't exist in inventory_items.
CREATE OR REPLACE FUNCTION public.restore_inventory_batch(p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line       jsonb;
  v_variant_id uuid;
  v_qty        integer;
  v_processed  integer := 0;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'INVQT',
      MESSAGE = 'INVALID_QUANTITY: p_lines must be a non-null jsonb array';
  END IF;
  IF jsonb_array_length(p_lines) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'processed', 0);
  END IF;

  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    v_variant_id := (v_line ->> 'variant_id')::uuid;
    v_qty        := (v_line ->> 'qty')::integer;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'INVQT',
        MESSAGE = format('INVALID_QUANTITY: qty=%s for variant %s at index %s',
          v_qty, v_variant_id, v_processed);
    END IF;

    UPDATE public.inventory_items
       SET quantity_available = quantity_available + v_qty,
           updated_at         = now()
     WHERE variant_id = v_variant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        MESSAGE = format(
          'INVENTORY_NOT_FOUND for variant %s at index %s',
          v_variant_id, v_processed
        );
    END IF;

    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'processed', v_processed);
END;
$$;

COMMENT ON FUNCTION public.restore_inventory_batch(jsonb) IS
'Atomic batch restore of inventory units (refund / cancel path). Raises P0001 INVENTORY_NOT_FOUND if any variant_id has no inventory_items row.';

REVOKE EXECUTE ON FUNCTION public.restore_inventory_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_inventory_batch(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
