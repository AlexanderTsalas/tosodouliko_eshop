-- =============================================================================
-- Phase 2b — Batch availability RPCs (set-based reads).
--
-- Background:
--   The current per-variant effective_available_for / contestable_available_for
--   functions are called in JS loops:
--     - getEffectiveAvailableForVariants    (storefront product page)
--     - getContestableAvailableForVariants  (storefront, catalog, sitemap)
--     - getWishlist's availability fold    (wishlist page)
--     - identifyContested in startCheckoutSession (checkout contention)
--   A 10-variant product page = 10 sequential RPC round-trips + 10 inline
--   cleanup writes per render. Wishlist with N items = N round-trips.
--
--   These two new functions accept a variant_id ARRAY and return a TABLE
--   of (variant_id, qty), so one round-trip resolves the whole batch
--   server-side.
--
--   Design choice — opportunistic cleanup:
--     The per-variant effective_available_for runs
--     cleanup_expired_sessions_for_variant inline (read-with-write).
--     The batch variant does NOT — it's marked STABLE so it can be
--     called from any context including PostgREST without the side
--     effect. The reaper cron continues to handle session cleanup in
--     the background. This is the explicit trade documented in the
--     implementation plan: storefront pages render slightly faster +
--     stop racing the cleanup writes.
--
--   Design choice — viewer resolution:
--     The per-row effective_available_for takes p_viewer_id and resolves
--     it via customers.auth_user_id. The batch version preserves the
--     same contract — pass auth.uid() or NULL. Resolution happens once
--     at the top of the function, not per-variant.
-- =============================================================================

-- ──── effective_available_for_many ───────────────────────────────────────────
-- Set-based viewer-aware availability. Output one row per input variant
-- (zero qty if no inventory row exists). Equivalent to calling
-- effective_available_for for each id, minus the inline cleanup.
CREATE OR REPLACE FUNCTION public.effective_available_for_many(
  p_variant_ids uuid[],
  p_viewer_id   uuid DEFAULT NULL
)
RETURNS TABLE(variant_id uuid, qty integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_id uuid := NULL;
BEGIN
  IF p_variant_ids IS NULL OR cardinality(p_variant_ids) = 0 THEN
    RETURN;  -- empty result set
  END IF;

  -- Resolve auth.uid() → customers.id once for the whole batch
  IF p_viewer_id IS NOT NULL THEN
    SELECT c.id
      INTO v_customer_id
      FROM public.customers c
     WHERE c.auth_user_id = p_viewer_id
     LIMIT 1;
  END IF;

  RETURN QUERY
  WITH
    -- Base availability per variant (LEFT JOIN so missing inventory rows
    -- still appear with qty=0 — matches per-row function's
    -- COALESCE(v_base, 0) behavior)
    base AS (
      SELECT
        v_in.variant_id,
        COALESCE(i.quantity_available, 0) AS available
      FROM unnest(p_variant_ids) AS v_in(variant_id)
      LEFT JOIN public.inventory_items i ON i.variant_id = v_in.variant_id
    ),
    -- Viewer's own soft + hard cart contributions (across any of their
    -- open cart_checkout_sessions). Empty CTE if no customer resolved.
    own_cart AS (
      SELECT ci.variant_id, COALESCE(SUM(ci.quantity), 0)::integer AS qty
      FROM public.cart_checkout_sessions s
      JOIN public.cart_items ci ON ci.cart_id = s.cart_id
      WHERE v_customer_id IS NOT NULL
        AND s.customer_id = v_customer_id
        AND s.state IN ('soft', 'hard')
        AND ci.variant_id = ANY(p_variant_ids)
        AND ci.quantity > 0
      GROUP BY ci.variant_id
    ),
    -- Viewer's active priority holds for any of the variants
    own_prio AS (
      SELECT ph.variant_id, COALESCE(SUM(ph.quantity), 0)::integer AS qty
      FROM public.priority_holds ph
      WHERE v_customer_id IS NOT NULL
        AND ph.customer_id = v_customer_id
        AND ph.consumed_at IS NULL
        AND ph.expires_at > now()
        AND ph.variant_id = ANY(p_variant_ids)
      GROUP BY ph.variant_id
    ),
    -- Viewer's in-flight pending orders touching the variants
    own_pending AS (
      SELECT oi.variant_id, COALESCE(SUM(oi.quantity), 0)::integer AS qty
      FROM public.orders o
      JOIN public.order_items oi ON oi.order_id = o.id
      WHERE v_customer_id IS NOT NULL
        AND o.customer_id = v_customer_id
        AND o.payment_status = 'pending'
        AND o.fulfillment_status NOT IN ('cancelled', 'delivered', 'picked_up')
        AND oi.variant_id = ANY(p_variant_ids)
      GROUP BY oi.variant_id
    )
  SELECT
    b.variant_id,
    GREATEST(
      b.available
        + COALESCE(oc.qty, 0)
        + COALESCE(op.qty, 0)
        + COALESCE(opd.qty, 0),
      0
    )::integer AS qty
  FROM base b
  LEFT JOIN own_cart    oc  ON oc.variant_id  = b.variant_id
  LEFT JOIN own_prio    op  ON op.variant_id  = b.variant_id
  LEFT JOIN own_pending opd ON opd.variant_id = b.variant_id;
END;
$$;

COMMENT ON FUNCTION public.effective_available_for_many(uuid[], uuid) IS
'Batch viewer-aware availability. Returns one row per input variant_id with the per-viewer effective qty (base + viewer-own holds, never negative). Mirrors effective_available_for semantics but does NOT run inline session cleanup (the reaper cron handles that).';

REVOKE EXECUTE ON FUNCTION public.effective_available_for_many(uuid[], uuid)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.effective_available_for_many(uuid[], uuid)
  TO service_role;

-- ──── contestable_available_for_many ─────────────────────────────────────────
-- Set-based contestable availability. Different from above:
--   contestable = quantity_available + quantity_soft_held + active_priority_held
-- Used for storefront-wide "is this still in play?" decisions
-- (Add-to-cart vs Notify-me CTA, catalog OOS gating). Not viewer-aware.
CREATE OR REPLACE FUNCTION public.contestable_available_for_many(
  p_variant_ids uuid[]
)
RETURNS TABLE(variant_id uuid, qty integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_variant_ids IS NULL OR cardinality(p_variant_ids) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH
    base AS (
      SELECT
        v_in.variant_id,
        COALESCE(i.quantity_available, 0) AS available,
        COALESCE(i.quantity_soft_held, 0) AS soft_held
      FROM unnest(p_variant_ids) AS v_in(variant_id)
      LEFT JOIN public.inventory_items i ON i.variant_id = v_in.variant_id
    ),
    prio AS (
      SELECT ph.variant_id, COALESCE(SUM(ph.quantity), 0)::integer AS qty
      FROM public.priority_holds ph
      WHERE ph.consumed_at IS NULL
        AND ph.expires_at > now()
        AND ph.variant_id = ANY(p_variant_ids)
      GROUP BY ph.variant_id
    )
  SELECT
    b.variant_id,
    (b.available + b.soft_held + COALESCE(p.qty, 0))::integer AS qty
  FROM base b
  LEFT JOIN prio p ON p.variant_id = b.variant_id;
END;
$$;

COMMENT ON FUNCTION public.contestable_available_for_many(uuid[]) IS
'Batch contestable availability. Returns one row per input variant_id with quantity_available + quantity_soft_held + active priority_holds. Used by catalog/product CTAs to decide "still in play?" Does NOT run inline cleanup.';

REVOKE EXECUTE ON FUNCTION public.contestable_available_for_many(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.contestable_available_for_many(uuid[])
  TO service_role;

NOTIFY pgrst, 'reload schema';
