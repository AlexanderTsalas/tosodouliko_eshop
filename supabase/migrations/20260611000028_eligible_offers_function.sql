-- =============================================================================
-- Offers engine — Phase 1: eligible_offers SQL function.
--
-- Returns offers that pass all OFFER-LEVEL conditionals for a given
-- evaluation context. Per-LINE eligibility (which lines within the cart
-- qualify for each offer, especially under stock-threshold rules per
-- decision #11) is filtered downstream in TypeScript via
-- evaluateOffersForCart — that step needs per-variant inventory data
-- that's expensive to join here.
--
-- This function is the single SQL gate that ensures the engine's WHERE
-- clause stays correct. Adding a new offer-level conditional means
-- updating this function in one place; the TS engine then composes it.
--
-- Conditionals checked here (offer-level only):
--   1. active = true
--   2. time window: starts_at..ends_at brackets p_now
--   3. user_type matches p_user_type ('any' always matches)
--   4. min_subtotal threshold (cart-shape, not per-line)
--   5. min_item_count threshold
--   6. enforce_limits gate: if true, max_uses_total + max_uses_per_customer
--      are honored as HARD limits; if false they're soft (engine handles
--      warning in TS)
--   7. code requirement: code matches one of p_codes (or requires_code=false)
--   8. customer whitelist on the matched code (offer_code_customers junction)
--   9. at least one scope matches the cart (scope='all' OR variant_id/
--      product_id/category_id in scope)
--
-- Stock-threshold conditional is NOT enforced here — it requires per-line
-- evaluation against effective stock (decision #15), which lives in the
-- TS engine. This function returns offers that pass OFFER-LEVEL
-- conditionals; the TS layer filters per-line afterward.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.eligible_offers(
  p_now            timestamptz,
  p_user_type      text,        -- 'authenticated' | 'guest'
  p_customer_id    uuid,        -- NULL for guests
  p_codes          text[],      -- code(s) the customer entered; can be empty
  p_subtotal       numeric,
  p_item_count     integer,
  p_variant_ids    uuid[],
  p_product_ids    uuid[],
  p_category_ids   uuid[]
)
RETURNS TABLE(
  id                     uuid,
  matched_code_id        uuid,    -- the offer_code that satisfied the code gate (if any)
  matched_affiliate_id   uuid     -- denorm from the matched code for downstream attribution
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    matched.code_id AS matched_code_id,
    matched.affiliate_id AS matched_affiliate_id
  FROM public.offers o
  -- Code-matching subquery. Returns one row per offer:
  --   - code_id IS NOT NULL when the offer has at least one offer_code
  --     whose `code` is in p_codes AND (no customer whitelist OR
  --     p_customer_id is in the whitelist OR auto_apply applies).
  --   - code_id IS NULL when the offer has no associated code at all
  --     (auto-apply offers).
  -- The LATERAL pattern keeps the matched-code lookup per-offer so we
  -- can return the matched code_id alongside the offer.
  LEFT JOIN LATERAL (
    SELECT
      oc.id AS code_id,
      oc.affiliate_id AS affiliate_id
    FROM public.offer_codes oc
    WHERE oc.offer_id = o.id
      AND oc.active = true
      AND (
        -- Customer typed this code
        (p_codes IS NOT NULL AND oc.code = ANY(p_codes))
        -- OR the code auto-applies for this customer (gift code with
        -- auto_apply=true)
        OR EXISTS (
          SELECT 1 FROM public.offer_code_customers occ
          WHERE occ.offer_code_id = oc.id
            AND occ.customer_id = p_customer_id
            AND occ.auto_apply = true
            AND p_customer_id IS NOT NULL
        )
      )
      -- Customer whitelist gate: if the code has a whitelist, customer
      -- must be on it OR auto_apply was the path that picked this code.
      AND (
        NOT EXISTS (SELECT 1 FROM public.offer_code_customers occ2 WHERE occ2.offer_code_id = oc.id)
        OR (
          p_customer_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.offer_code_customers occ3
            WHERE occ3.offer_code_id = oc.id AND occ3.customer_id = p_customer_id
          )
        )
      )
    ORDER BY oc.created_at ASC   -- deterministic when multiple codes match
    LIMIT 1
  ) matched ON true
  WHERE
    o.active = true
    -- Time window
    AND (o.starts_at IS NULL OR o.starts_at <= p_now)
    AND (o.ends_at IS NULL OR o.ends_at > p_now)
    -- User type gate
    AND (o.user_type = 'any' OR o.user_type = p_user_type)
    -- Cart-shape thresholds
    AND (o.min_subtotal IS NULL OR p_subtotal >= o.min_subtotal)
    AND (o.min_item_count IS NULL OR p_item_count >= o.min_item_count)
    -- Hard usage limits (only when enforce_limits=true; soft mode skips
    -- these checks and lets the TS engine emit warnings)
    AND (
      o.enforce_limits = false
      OR o.max_uses_total IS NULL
      OR o.current_uses < o.max_uses_total
    )
    AND (
      o.enforce_limits = false
      OR o.max_uses_per_customer IS NULL
      OR p_customer_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.offer_customer_usage ocu
        WHERE ocu.offer_id = o.id
          AND ocu.customer_id = p_customer_id
          AND ocu.use_count >= o.max_uses_per_customer
      )
    )
    -- Code requirement: if the offer requires a code, the code-match
    -- LATERAL must have produced a row.
    AND (
      o.requires_code = false
      OR matched.code_id IS NOT NULL
    )
    -- Scope gate: at least one offer_scope must apply to the cart.
    AND EXISTS (
      SELECT 1 FROM public.offer_scopes os
      WHERE os.offer_id = o.id
        AND (
          os.scope_kind = 'all'
          OR (os.scope_kind = 'variant'  AND os.resource_id = ANY(p_variant_ids))
          OR (os.scope_kind = 'product'  AND os.resource_id = ANY(p_product_ids))
          OR (os.scope_kind = 'category' AND os.resource_id = ANY(p_category_ids))
        )
    );
END;
$$;

COMMENT ON FUNCTION public.eligible_offers(
  timestamptz, text, uuid, text[], numeric, integer, uuid[], uuid[], uuid[]
) IS
'Returns offers that pass all OFFER-LEVEL conditionals for a given cart context. Per-LINE eligibility (stock threshold, per-line scope filtering) happens downstream in the TS engine (evaluateOffersForCart). This function is the single SQL gate so new offer-level conditionals are added in one place.';

NOTIFY pgrst, 'reload schema';
