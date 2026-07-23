-- =============================================================================
-- Phase 10 — Spec §16.1 — Multi-tab self-contention.
--
-- Before this migration `effective_available_for(variant, viewer)` returned
-- the global `quantity_available` regardless of viewer. That meant a
-- customer with X in cart who opened the same product page in a second
-- tab would see "out of stock" because their own soft / priority / reserved
-- holds had decremented the public counter.
--
-- After: when a viewer is supplied, sum the holds attributable to that
-- viewer's own customer and add them back. The result is "what this viewer
-- could acquire if they wanted to" — their own claims are still acquirable
-- by them, just not by anyone else.
--
-- Holds contributing to the viewer's own claim:
--   - soft_held    via cart_checkout_sessions(state IN soft, hard)
--                  → cart_items qty
--   - priority_held via priority_holds(consumed_at IS NULL) for this variant
--                  in the viewer's name
--   - reserved     via orders(payment_status='pending', fulfillment_status
--                  NOT IN ('cancelled', 'delivered', 'picked_up')) →
--                  order_items qty
-- =============================================================================

CREATE OR REPLACE FUNCTION public.effective_available_for(
  p_variant_id uuid,
  p_viewer_id  uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_base       integer;
  v_own_holds  integer := 0;
  v_customer_id uuid;
BEGIN
  BEGIN
    PERFORM public.cleanup_expired_sessions_for_variant(p_variant_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'effective_available_for: opportunistic cleanup failed for variant %: %',
      p_variant_id, SQLERRM;
  END;

  SELECT quantity_available
  INTO v_base
  FROM public.inventory_items
  WHERE variant_id = p_variant_id;
  v_base := COALESCE(v_base, 0);

  IF p_viewer_id IS NULL THEN
    RETURN GREATEST(v_base, 0);
  END IF;

  -- Resolve auth.uid() → customers.id once.
  SELECT id
  INTO v_customer_id
  FROM public.customers
  WHERE auth_user_id = p_viewer_id
  LIMIT 1;
  IF v_customer_id IS NULL THEN
    RETURN GREATEST(v_base, 0);
  END IF;

  -- Soft + hard contributions (cart sessions touching this variant).
  SELECT v_own_holds + COALESCE(SUM(ci.quantity), 0)
  INTO v_own_holds
  FROM public.cart_checkout_sessions s
  JOIN public.cart_items ci ON ci.cart_id = s.cart_id
  WHERE s.customer_id = v_customer_id
    AND s.state IN ('soft', 'hard')
    AND ci.variant_id = p_variant_id
    AND ci.quantity > 0;

  -- Priority hold contribution (this viewer's own active hold for the variant).
  SELECT v_own_holds + COALESCE(SUM(quantity), 0)
  INTO v_own_holds
  FROM public.priority_holds
  WHERE variant_id = p_variant_id
    AND customer_id = v_customer_id
    AND consumed_at IS NULL
    AND expires_at > now();

  -- Reserved contribution (an active in-flight order in this viewer's name
  -- with this variant). Cancelled / delivered / picked_up orders no longer
  -- reserve, so they're excluded.
  SELECT v_own_holds + COALESCE(SUM(oi.quantity), 0)
  INTO v_own_holds
  FROM public.orders o
  JOIN public.order_items oi ON oi.order_id = o.id
  WHERE o.customer_id = v_customer_id
    AND o.payment_status = 'pending'
    AND o.fulfillment_status NOT IN ('cancelled', 'delivered', 'picked_up')
    AND oi.variant_id = p_variant_id;

  RETURN GREATEST(v_base + v_own_holds, 0);
END;
$$;

COMMENT ON FUNCTION public.effective_available_for IS
  'Per-viewer effective availability. Runs opportunistic cleanup of expired sessions for this variant before reading quantity_available, then for an authenticated viewer adds back the viewer''s own soft / priority / reserved contributions — so a customer with X in cart doesn''t see "out of stock" when they open the same product in a second tab.';
