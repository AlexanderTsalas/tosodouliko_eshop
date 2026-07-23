-- =============================================================================
-- Offers engine v2.1 — Path A: simplified eligible_rules SQL function.
--
-- After conditions moved to their own table (migration 34), this function
-- shrinks to just three coarse checks that SQL is good at:
--   1. rule.active = true
--   2. OR-of-parents: rule has no offer memberships, OR at least one
--      parent offer is active
--   3. At least one scope matches the cart's variant/product/category set
--
-- All condition evaluation (time window, user type, subtotal threshold,
-- usage limits, stock threshold) now happens in the TS engine because:
--   - Each condition is generic (typed via `kind` + jsonb config)
--   - Adding a new condition kind doesn't change this SQL signature
--   - TS is easier to test for the conditional logic
--
-- This intentionally also drops the rule-level user filtering (codes,
-- code-customer whitelist, user_type, subtotal/item_count) — all moved
-- to TS evaluators. The function returns ALL rules whose scope matches
-- the cart; TS then filters by conditions.
-- =============================================================================

-- Drop the old (heavier) signature first.
DROP FUNCTION IF EXISTS public.eligible_rules(
  timestamptz, text, uuid, text[], numeric, integer, uuid[], uuid[], uuid[]
);

CREATE OR REPLACE FUNCTION public.eligible_rules(
  p_variant_ids   uuid[],
  p_product_ids   uuid[],
  p_category_ids  uuid[]
)
RETURNS SETOF public.rules
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT r.* FROM public.rules r
  WHERE
    r.active = true
    -- OR-of-parents
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.offer_rule_memberships orm
        WHERE orm.rule_id = r.id
      )
      OR EXISTS (
        SELECT 1 FROM public.offer_rule_memberships orm
        JOIN public.offers o ON o.id = orm.offer_id
        WHERE orm.rule_id = r.id AND o.active = true
      )
    )
    -- ≥1 scope matches
    AND EXISTS (
      SELECT 1 FROM public.rule_scopes rs
      WHERE rs.rule_id = r.id
        AND (
          rs.scope_kind = 'all'
          OR (rs.scope_kind = 'variant' AND rs.resource_id = ANY(p_variant_ids))
          OR (rs.scope_kind = 'product' AND rs.resource_id = ANY(p_product_ids))
          OR (rs.scope_kind = 'category' AND rs.resource_id = ANY(p_category_ids))
        )
    );
END;
$$;

COMMENT ON FUNCTION public.eligible_rules(uuid[], uuid[], uuid[]) IS
'Coarse SQL filter — returns rules whose scope matches the cart and whose own/parent activation passes. All condition evaluation (time, user type, subtotal threshold, usage limits, stock threshold) happens in the TS engine via the rule_conditions table.';

NOTIFY pgrst, 'reload schema';
