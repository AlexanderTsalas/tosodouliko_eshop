-- =============================================================================
-- Offers engine v2 — SQL function updates after the rules-first reshape.
--
-- Replaces:
--   eligible_offers → eligible_rules (operates on the new `rules` table,
--                                     enforces the OR-of-parents check
--                                     for M2M offer membership)
--   record_offer_usage → record_rule_usage (increments per-rule counters)
--
-- The legacy function names are dropped to avoid the codebase calling
-- both — v2 is a clean cut.
-- =============================================================================

DROP FUNCTION IF EXISTS public.eligible_offers(
  timestamptz, text, uuid, text[], numeric, integer, uuid[], uuid[], uuid[]
);
DROP FUNCTION IF EXISTS public.record_offer_usage(uuid[], uuid);

-- ---------------------------------------------------------------------------
-- eligible_rules — replaces eligible_offers
--
-- Returns rules that pass all RULE-LEVEL conditionals + the OR-of-parents
-- offer-membership check. Per-line eligibility (stock threshold, per-line
-- scope match) is filtered downstream in TS (per-line evaluation requires
-- effective-stock data that's expensive to join here).
--
-- Returned columns:
--   id                    — rule.id
--   matched_code_id       — the rule_code that satisfied the code gate (if any)
--   matched_affiliate_id  — denorm from the matched code for downstream attribution
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.eligible_rules(
  p_now            timestamptz,
  p_user_type      text,
  p_customer_id    uuid,
  p_codes          text[],
  p_subtotal       numeric,
  p_item_count     integer,
  p_variant_ids    uuid[],
  p_product_ids    uuid[],
  p_category_ids   uuid[]
)
RETURNS TABLE(
  id                     uuid,
  matched_code_id        uuid,
  matched_affiliate_id   uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    matched.code_id,
    matched.affiliate_id
  FROM public.rules r
  -- Code-match LATERAL: per-rule, find a rule_code that satisfies either
  -- explicit code-entry or auto-apply, AND passes the customer whitelist.
  LEFT JOIN LATERAL (
    SELECT
      rc.id AS code_id,
      rc.affiliate_id AS affiliate_id
    FROM public.rule_codes rc
    WHERE rc.rule_id = r.id
      AND rc.active = true
      AND (
        (p_codes IS NOT NULL AND rc.code = ANY(p_codes))
        OR EXISTS (
          SELECT 1 FROM public.rule_code_customers rcc
          WHERE rcc.rule_code_id = rc.id
            AND rcc.customer_id = p_customer_id
            AND rcc.auto_apply = true
            AND p_customer_id IS NOT NULL
        )
      )
      AND (
        -- No whitelist → universal
        NOT EXISTS (SELECT 1 FROM public.rule_code_customers rcc2 WHERE rcc2.rule_code_id = rc.id)
        -- OR customer is whitelisted
        OR (
          p_customer_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.rule_code_customers rcc3
            WHERE rcc3.rule_code_id = rc.id AND rcc3.customer_id = p_customer_id
          )
        )
      )
    ORDER BY rc.created_at ASC
    LIMIT 1
  ) matched ON true
  WHERE
    r.active = true
    -- OR-of-parents check (decision Q2): if the rule has any offer
    -- memberships, at least one parent offer must be active. If the
    -- rule has no memberships, it applies based on its own active flag
    -- alone (orphan rule).
    AND (
      NOT EXISTS (SELECT 1 FROM public.offer_rule_memberships orm WHERE orm.rule_id = r.id)
      OR EXISTS (
        SELECT 1
        FROM public.offer_rule_memberships orm
        JOIN public.offers o ON o.id = orm.offer_id
        WHERE orm.rule_id = r.id AND o.active = true
      )
    )
    -- Time window
    AND (r.starts_at IS NULL OR r.starts_at <= p_now)
    AND (r.ends_at IS NULL OR r.ends_at > p_now)
    -- User type
    AND (r.user_type = 'any' OR r.user_type = p_user_type)
    -- Cart-shape thresholds
    AND (r.min_subtotal IS NULL OR p_subtotal >= r.min_subtotal)
    AND (r.min_item_count IS NULL OR p_item_count >= r.min_item_count)
    -- Hard usage limits (only when enforce_limits=true)
    AND (
      r.enforce_limits = false
      OR r.max_uses_total IS NULL
      OR r.current_uses < r.max_uses_total
    )
    AND (
      r.enforce_limits = false
      OR r.max_uses_per_customer IS NULL
      OR p_customer_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.rule_customer_usage rcu
        WHERE rcu.rule_id = r.id
          AND rcu.customer_id = p_customer_id
          AND rcu.use_count >= r.max_uses_per_customer
      )
    )
    -- Code requirement
    AND (
      r.requires_code = false
      OR matched.code_id IS NOT NULL
    )
    -- At least one scope matches the cart
    AND EXISTS (
      SELECT 1 FROM public.rule_scopes rs
      WHERE rs.rule_id = r.id
        AND (
          rs.scope_kind = 'all'
          OR (rs.scope_kind = 'variant'  AND rs.resource_id = ANY(p_variant_ids))
          OR (rs.scope_kind = 'product'  AND rs.resource_id = ANY(p_product_ids))
          OR (rs.scope_kind = 'category' AND rs.resource_id = ANY(p_category_ids))
        )
    );
END;
$$;

COMMENT ON FUNCTION public.eligible_rules(
  timestamptz, text, uuid, text[], numeric, integer, uuid[], uuid[], uuid[]
) IS
'Returns rules eligible per offer-level + rule-level + OR-of-parents conditionals. Per-line filtering (stock threshold per variant, per-line scope) happens downstream in TS.';

-- ---------------------------------------------------------------------------
-- record_rule_usage — replaces record_offer_usage
--
-- Atomically bumps rules.current_uses + rule_customer_usage counters
-- for one or more rules.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_rule_usage(
  p_rule_ids    uuid[],
  p_customer_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.rules
  SET current_uses = current_uses + 1
  WHERE id = ANY(p_rule_ids);

  IF p_customer_id IS NOT NULL THEN
    INSERT INTO public.rule_customer_usage (rule_id, customer_id, use_count, last_used_at)
    SELECT unnest(p_rule_ids), p_customer_id, 1, now()
    ON CONFLICT (rule_id, customer_id)
    DO UPDATE SET
      use_count    = public.rule_customer_usage.use_count + 1,
      last_used_at = now();
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_rule_usage(uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_rule_usage(uuid[], uuid) TO service_role;

COMMENT ON FUNCTION public.record_rule_usage(uuid[], uuid) IS
'v2 replacement for record_offer_usage. Atomically bumps per-rule counters; called once per order commit by placeOrder.';

NOTIFY pgrst, 'reload schema';
