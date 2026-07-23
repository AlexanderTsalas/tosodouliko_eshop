-- =============================================================================
-- contestable_available_for — "is this variant still in play?"
--
-- Distinct from effective_available_for(), which answers "can THIS viewer
-- acquire X right now." Contestable counts everything not-yet-sold:
--
--     contestable = quantity_available + quantity_soft_held + quantity_priority_held
--
-- Soft holds (someone in checkout) and priority holds (wishlist promotion or
-- soft-wait promotion) are temporary — the holder might abandon or time out,
-- and the items return to `quantity_available`. Other shoppers should be
-- able to see and contest them via the existing "Add to cart and wait"
-- contention flow. Only `quantity_reserved` (paid/in-flight orders) is
-- treated as truly gone.
--
-- This drives:
--   - storefront product-page CTA: "Add to cart" while contestable > 0,
--     "Notify me" only when contestable = 0.
--   - catalog visibility under the `show_when_oos` cascade.
--   - sitemap and direct-URL gating.
--
-- effective_available_for() stays in place for the cart-side contention
-- check (deciding whether an add succeeds outright or shows the modal).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.contestable_available_for(
  p_variant_id uuid
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_total integer;
BEGIN
  -- Same opportunistic cleanup as effective_available_for: stale sessions
  -- get released before we read the buckets so we don't return inflated
  -- "in play" numbers for already-abandoned holders.
  BEGIN
    PERFORM public.cleanup_expired_sessions_for_variant(p_variant_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'contestable_available_for: cleanup failed for variant %: %',
      p_variant_id, SQLERRM;
  END;

  SELECT COALESCE(
    quantity_available + quantity_soft_held + quantity_priority_held,
    0
  )
  INTO v_total
  FROM public.inventory_items
  WHERE variant_id = p_variant_id;

  RETURN GREATEST(COALESCE(v_total, 0), 0);
END;
$$;

COMMENT ON FUNCTION public.contestable_available_for IS
  'Units still in motion: available + soft_held + priority_held. Drives storefront visibility and CTA. Only quantity_reserved is treated as truly gone. Compare effective_available_for (per-viewer acquisition check).';

GRANT EXECUTE ON FUNCTION public.contestable_available_for(uuid) TO anon, authenticated;
