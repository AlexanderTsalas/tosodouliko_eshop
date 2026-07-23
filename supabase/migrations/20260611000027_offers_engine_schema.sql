-- =============================================================================
-- Offers engine — Phase 1: schema foundation.
--
-- See docs/offers-engine-implementation-plan.md for the full design rationale.
-- This migration creates the 8 new tables that together model:
--   - Offers (named containers with conditionals)
--   - Offer scopes (what the offer targets)
--   - Offer rules (what the offer does)
--   - Offer codes (replaces the legacy discount_codes; named `offer_codes`
--     during the transition to avoid colliding with the legacy table that
--     stays in place until Phase 4 when applyDiscount is rewritten)
--   - Offer-code-to-customer junction (gift codes + auto-apply)
--   - Per-customer usage counters (for max_uses_per_customer)
--   - Order audit trail (which offer applied to which order)
--   - Affiliates (separate entity that owns universal codes for attribution)
--
-- Naming note:
--   The plan document uses `discount_codes` as the semantic name. To avoid
--   collision with the legacy table during Phase 1-3, the actual table is
--   created as `offer_codes`. Phase 4 (when the legacy applyDiscount action
--   is rewritten to use the new engine) drops the legacy `discount_codes`
--   table; at that point this table can be renamed `discount_codes` if
--   desired, OR the codebase moves on with `offer_codes` as the canonical
--   name. Either way no behavior changes.
--
-- RBAC defense (decision #14 in the plan):
--   Every write path goes through 4 independent layers:
--     1. RLS policy here — `manage:discounts` permission gate
--     2. checkPermission() in server actions (Phase 2)
--     3. Audit logging via logAuditEvent (Phase 2)
--     4. <RequirePermission> UI guards (Phase 2)
--   Public SELECT is restricted to "safe" offers (active=true AND
--   requires_code=false) so the storefront can compute auto-apply prices
--   for anonymous visitors without leaking code-required offers.
--
-- Soft-vs-hard enforcement (decision #17):
--   `offers.enforce_limits` controls whether max_uses_total +
--   max_uses_per_customer are HARD gates (engine refuses) or SOFT warnings
--   (engine continues; admin sees banners). Default false (SOFT).
--
-- Race conditions (decisions #15-#16):
--   This migration does NOT yet add `cart_checkout_sessions.offer_snapshot`
--   or the stock-threshold integration with getContestableAvailable —
--   those land in Phases 4 and 7 respectively. The schema below has all
--   the columns those phases need.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. offers — the named container
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.offers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL,
  description            text,
  active                 boolean NOT NULL DEFAULT true,

  -- Eligibility conditionals (all nullable = "no gate")
  starts_at              timestamptz,
  ends_at                timestamptz,
  user_type              text NOT NULL DEFAULT 'any',
  requires_code          boolean NOT NULL DEFAULT false,
  min_subtotal           numeric(10,2),
  min_item_count         integer,

  -- Stacking + limits
  stacking_mode          text NOT NULL DEFAULT 'exclusive_within_kind',
  priority               integer NOT NULL DEFAULT 0,
  max_uses_total         integer,
  max_uses_per_customer  integer,
  current_uses           integer NOT NULL DEFAULT 0,
  -- Soft-vs-hard enforcement flag (decision #17). When true, the engine
  -- refuses to apply past max_uses_total and max_uses_per_customer.
  -- When false (default), engine keeps applying + admin sees warning
  -- banners.
  enforce_limits         boolean NOT NULL DEFAULT false,

  -- Stock-threshold conditional (all nullable = no stock gating). The
  -- engine integrates with getContestableAvailable in Phase 7; this
  -- migration just lays the columns.
  stock_threshold        integer,
  stock_scope_kind       text,      -- 'variant' | 'product' | NULL
  stock_scope_id         uuid,

  -- Bookkeeping
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- Integrity checks
  CHECK (user_type IN ('any','authenticated','guest')),
  CHECK (stacking_mode IN ('stack','exclusive_within_kind','global_exclusive')),
  CHECK (stock_threshold IS NULL OR stock_scope_kind IS NOT NULL),
  CHECK (stock_scope_kind IS NULL OR stock_scope_kind IN ('variant','product')),
  CHECK ((stock_threshold IS NULL) = (stock_scope_id IS NULL)),
  CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  CHECK (min_subtotal IS NULL OR min_subtotal >= 0),
  CHECK (min_item_count IS NULL OR min_item_count > 0),
  CHECK (max_uses_total IS NULL OR max_uses_total > 0),
  CHECK (max_uses_per_customer IS NULL OR max_uses_per_customer > 0),
  CHECK (current_uses >= 0)
);

CREATE INDEX IF NOT EXISTS idx_offers_active_lookup
  ON public.offers(active) WHERE active = true;
-- Storefront catalog hits this twice: "is the offer in its time window"
-- and "is it not over its hard cap"
CREATE INDEX IF NOT EXISTS idx_offers_active_time_window
  ON public.offers(starts_at, ends_at)
  WHERE active = true AND requires_code = false;

ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;

-- Layer 1 of the defense-in-depth: RLS on every write path.
CREATE POLICY "offers_admin_write"
  ON public.offers FOR ALL TO authenticated
  USING (public.has_permission('manage:discounts'))
  WITH CHECK (public.has_permission('manage:discounts'));

-- Public read is restricted to "safe" rows the storefront actually needs.
-- This is what lets the catalog compute auto-apply discount prices for
-- anonymous visitors without exposing code-required offers.
CREATE POLICY "offers_select_storefront_safe"
  ON public.offers FOR SELECT TO anon, authenticated
  USING (active = true AND requires_code = false);

-- Admins see everything (active or not, code-required or not).
CREATE POLICY "offers_select_admin_all"
  ON public.offers FOR SELECT TO authenticated
  USING (public.has_permission('manage:discounts'));

COMMENT ON TABLE public.offers IS
'Named container for one or more rules + conditionals. The "offer" entity is the semantic unit the admin reasons about ("Black Friday 2025"); rules are its actions; scopes are its targeting. Currently legacy discount_codes table coexists; offers engine becomes authoritative in Phase 4.';

COMMENT ON COLUMN public.offers.enforce_limits IS
'When true, max_uses_total + max_uses_per_customer are HARD gates (engine refuses to apply past them). When false (default), engine continues to apply and the admin sees warning banners. See decision #17 in docs/offers-engine-implementation-plan.md.';

COMMENT ON COLUMN public.offers.stacking_mode IS
'How this offer combines with other offers in the same cart: stack (combine with everything), exclusive_within_kind (only this offer wins within its rule kind — default), global_exclusive (this offer wins outright; everything else dropped).';

-- ---------------------------------------------------------------------------
-- 2. offer_scopes — what the offer targets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.offer_scopes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id     uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  scope_kind   text NOT NULL,
  resource_id  uuid,    -- NULL when scope_kind='all'
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (scope_kind IN ('all','category','product','variant')),
  CHECK ((scope_kind = 'all') = (resource_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_offer_scopes_offer
  ON public.offer_scopes(offer_id);
-- Reverse lookup: "what offers target this product/variant/category?"
-- Used by the storefront catalog price-compute path.
CREATE INDEX IF NOT EXISTS idx_offer_scopes_resource
  ON public.offer_scopes(scope_kind, resource_id);

ALTER TABLE public.offer_scopes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "offer_scopes_admin_write"
  ON public.offer_scopes FOR ALL TO authenticated
  USING (public.has_permission('manage:discounts'))
  WITH CHECK (public.has_permission('manage:discounts'));
-- Public read mirrors offers: visible if the parent offer is visible.
-- Postgres can't elegantly join in RLS without a subquery; we use one.
CREATE POLICY "offer_scopes_select_storefront_safe"
  ON public.offer_scopes FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.offers o
    WHERE o.id = offer_id AND o.active = true AND o.requires_code = false
  ));
CREATE POLICY "offer_scopes_select_admin_all"
  ON public.offer_scopes FOR SELECT TO authenticated
  USING (public.has_permission('manage:discounts'));

COMMENT ON TABLE public.offer_scopes IS
'Many-to-one with offers. An offer can target multiple scopes (e.g., categories Toys + Books). scope_kind=all means store-wide.';

-- ---------------------------------------------------------------------------
-- 3. offer_rules — the actions (discriminated by `kind`)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.offer_rules (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id                    uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  active                      boolean NOT NULL DEFAULT true,
  kind                        text NOT NULL,

  -- Discount rule fields (NULL when kind is not a discount kind)
  -- For percent_discount: 0.20 = 20% off
  -- For flat_discount:    5.00 = €5 off (currency-agnostic per decision; see plan)
  discount_value              numeric(10,4),

  -- Bundle rule fields (NULL when kind != 'bundle_bxgy')
  trigger_scope_kind          text,   -- 'product' | 'variant' | 'category'
  trigger_scope_id            uuid,
  trigger_quantity            integer,
  reward_scope_kind           text,
  reward_scope_id             uuid,
  reward_quantity             integer,
  -- 1.0 = "100% off" (i.e., free); 0.5 = "50% off the reward"
  reward_discount             numeric(10,4) DEFAULT 1.0,
  -- NULL = greedy (engine loops until cart can't satisfy trigger anymore)
  max_applications_per_cart   integer,

  -- Service-fee waiver fields (NULL when kind is not a waiver kind)
  -- threshold_kind=NULL means "always waive when offer is eligible"
  waive_threshold_kind        text,
  waive_threshold_value       numeric(10,2),
  -- true (default) = store absorbs the carrier charge; carrier still gets
  -- paid via the api_quote column in fees_breakdown
  waive_customer_charge       boolean DEFAULT true,

  created_at                  timestamptz NOT NULL DEFAULT now(),

  CHECK (kind IN (
    'percent_discount','flat_discount',
    'bundle_bxgy',
    'waive_shipping','waive_cod','waive_all_fees'
  )),
  -- Discount kinds require discount_value
  CHECK (kind NOT IN ('percent_discount','flat_discount') OR discount_value IS NOT NULL),
  -- Percent discount is bounded 0..1
  CHECK (kind != 'percent_discount' OR (discount_value >= 0 AND discount_value <= 1)),
  -- Flat discount is positive
  CHECK (kind != 'flat_discount' OR discount_value > 0),
  -- Bundle kind requires trigger + reward
  CHECK (kind != 'bundle_bxgy' OR (
    trigger_scope_kind IS NOT NULL AND trigger_quantity IS NOT NULL AND trigger_quantity > 0
    AND reward_scope_kind IS NOT NULL AND reward_quantity IS NOT NULL AND reward_quantity > 0
  )),
  CHECK (trigger_scope_kind IS NULL OR trigger_scope_kind IN ('product','variant','category')),
  CHECK (reward_scope_kind IS NULL OR reward_scope_kind IN ('product','variant','category')),
  CHECK (waive_threshold_kind IS NULL OR waive_threshold_kind IN ('cart_total','products_total')),
  CHECK (waive_threshold_value IS NULL OR waive_threshold_value >= 0)
);

CREATE INDEX IF NOT EXISTS idx_offer_rules_offer_active
  ON public.offer_rules(offer_id) WHERE active = true;

ALTER TABLE public.offer_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "offer_rules_admin_write"
  ON public.offer_rules FOR ALL TO authenticated
  USING (public.has_permission('manage:discounts'))
  WITH CHECK (public.has_permission('manage:discounts'));
CREATE POLICY "offer_rules_select_storefront_safe"
  ON public.offer_rules FOR SELECT TO anon, authenticated
  USING (active = true AND EXISTS (
    SELECT 1 FROM public.offers o
    WHERE o.id = offer_id AND o.active = true AND o.requires_code = false
  ));
CREATE POLICY "offer_rules_select_admin_all"
  ON public.offer_rules FOR SELECT TO authenticated
  USING (public.has_permission('manage:discounts'));

COMMENT ON TABLE public.offer_rules IS
'Discriminated table by `kind`. Each kind only populates its relevant columns; CHECK constraints enforce the required combinations. One offer can have many rules (e.g., a bundle + a free-shipping waiver).';

-- ---------------------------------------------------------------------------
-- 4. affiliates — separate entity owning offer codes for attribution
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.affiliates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  email           text,
  contact_phone   text,
  commission_rate numeric(5,4) NOT NULL DEFAULT 0,
  commission_type text NOT NULL DEFAULT 'percent_of_subtotal',
  flat_commission numeric(10,2),
  payout_method   text,
  notes           text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (commission_type IN ('percent_of_subtotal','flat_per_order')),
  CHECK (commission_rate >= 0 AND commission_rate <= 1),
  CHECK (flat_commission IS NULL OR flat_commission >= 0)
);

CREATE INDEX IF NOT EXISTS idx_affiliates_active
  ON public.affiliates(active) WHERE active = true;

ALTER TABLE public.affiliates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "affiliates_admin_write"
  ON public.affiliates FOR ALL TO authenticated
  USING (public.has_permission('manage:discounts'))
  WITH CHECK (public.has_permission('manage:discounts'));
CREATE POLICY "affiliates_select_admin"
  ON public.affiliates FOR SELECT TO authenticated
  USING (public.has_permission('manage:discounts'));

COMMENT ON TABLE public.affiliates IS
'Per decision #18 in the implementation plan: affiliates are identified by the codes they distribute. The code itself is universal (anyone who knows it can use it); attribution happens via offer_codes.affiliate_id and lands in order_offer_applications.affiliate_id when an order uses an affiliate-attributed code.';

-- ---------------------------------------------------------------------------
-- 5. offer_codes — the customer-facing code mechanism
--   (replaces the legacy discount_codes; named offer_codes for now to
--   avoid collision while the legacy table stays in place during the
--   Phase 1-3 transition)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.offer_codes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,
  offer_id       uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  -- NULL for non-affiliate codes (regular promo + gift codes)
  affiliate_id   uuid REFERENCES public.affiliates(id) ON DELETE SET NULL,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_offer_codes_code
  ON public.offer_codes(code);
CREATE INDEX IF NOT EXISTS idx_offer_codes_offer
  ON public.offer_codes(offer_id);
CREATE INDEX IF NOT EXISTS idx_offer_codes_affiliate
  ON public.offer_codes(affiliate_id) WHERE affiliate_id IS NOT NULL;

ALTER TABLE public.offer_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "offer_codes_admin_write"
  ON public.offer_codes FOR ALL TO authenticated
  USING (public.has_permission('manage:discounts'))
  WITH CHECK (public.has_permission('manage:discounts'));
-- Public read is open for code lookup (customer typing a code into the
-- checkout form needs to be able to validate it). The active+offer
-- joins happen at the engine layer.
CREATE POLICY "offer_codes_select_public"
  ON public.offer_codes FOR SELECT TO anon, authenticated
  USING (true);

COMMENT ON TABLE public.offer_codes IS
'Replaces the legacy discount_codes table semantically; named offer_codes to avoid the namespace clash during Phase 1-3. Phase 4 (when applyDiscount is rewritten) drops the legacy discount_codes table.';

-- ---------------------------------------------------------------------------
-- 6. offer_code_customers — gift-code whitelist
--   (decision #18: NOT for affiliate codes — those stay universal)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.offer_code_customers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_code_id    uuid NOT NULL REFERENCES public.offer_codes(id) ON DELETE CASCADE,
  customer_id      uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  -- When true, engine auto-applies this code for this customer without
  -- requiring code entry. When false (default), customer must still
  -- enter the code; the junction is purely a permission gate.
  auto_apply       boolean NOT NULL DEFAULT false,
  added_at         timestamptz NOT NULL DEFAULT now(),
  added_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (offer_code_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_occ_code
  ON public.offer_code_customers(offer_code_id);
CREATE INDEX IF NOT EXISTS idx_occ_customer
  ON public.offer_code_customers(customer_id);
-- Storefront login-time query: "which auto-apply codes does this customer
-- have?" hits this index.
CREATE INDEX IF NOT EXISTS idx_occ_customer_auto_apply
  ON public.offer_code_customers(customer_id)
  WHERE auto_apply = true;

ALTER TABLE public.offer_code_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "occ_admin_write"
  ON public.offer_code_customers FOR ALL TO authenticated
  USING (public.has_permission('manage:discounts'))
  WITH CHECK (public.has_permission('manage:discounts'));
-- Customers can see their own assignments (so the storefront can show
-- "this code is yours" badges + auto-apply preview).
CREATE POLICY "occ_select_own"
  ON public.offer_code_customers FOR SELECT TO authenticated
  USING (
    customer_id IN (SELECT id FROM public.customers WHERE auth_user_id = auth.uid())
    OR public.has_permission('manage:discounts')
  );

COMMENT ON TABLE public.offer_code_customers IS
'Gift-code whitelist per decision #18. When EMPTY for an offer_code, the code is universal (anyone can use). When POPULATED, only listed customers can use it. The auto_apply flag triggers the engine to add the code without explicit entry at checkout — the frictionless gift flow.';

-- ---------------------------------------------------------------------------
-- 7. offer_customer_usage — per-customer usage tracking
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.offer_customer_usage (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id      uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  customer_id   uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  use_count     integer NOT NULL DEFAULT 0,
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offer_id, customer_id),
  CHECK (use_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_ocu_customer
  ON public.offer_customer_usage(customer_id);

ALTER TABLE public.offer_customer_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ocu_admin_read"
  ON public.offer_customer_usage FOR SELECT TO authenticated
  USING (public.has_permission('manage:discounts'));
-- Customers can read their own counters (no write — only the
-- record_offer_usage RPC writes here, running SECURITY DEFINER).
CREATE POLICY "ocu_select_own"
  ON public.offer_customer_usage FOR SELECT TO authenticated
  USING (customer_id IN (
    SELECT id FROM public.customers WHERE auth_user_id = auth.uid()
  ));

COMMENT ON TABLE public.offer_customer_usage IS
'Per-customer usage counter. Eliminates the need to count order_offer_applications rows for the per-customer limit check on every order. Writes happen only via the record_offer_usage RPC (Phase 4); never directly from application code.';

-- ---------------------------------------------------------------------------
-- 8. order_offer_applications — audit trail (CRITICAL)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_offer_applications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  -- RESTRICT not CASCADE: offers used historically must not be hard-
  -- deletable; admin soft-deactivates via offers.active=false.
  offer_id       uuid NOT NULL REFERENCES public.offers(id) ON DELETE RESTRICT,
  rule_id        uuid NOT NULL REFERENCES public.offer_rules(id) ON DELETE RESTRICT,
  code_id        uuid REFERENCES public.offer_codes(id) ON DELETE SET NULL,
  affiliate_id   uuid REFERENCES public.affiliates(id) ON DELETE SET NULL,
  -- The actual discount amount applied. Always positive (the math
  -- subtracts it from totals). Stored at the order's currency.
  amount_off     numeric(10,2) NOT NULL,
  currency       text NOT NULL,
  -- Per-line allocation in jsonb so refund proration (Phase 7) can
  -- reverse-engineer which lines were discounted by how much. Shape:
  -- [{ "variant_id": "<uuid>", "amount": 0.00 }, ...]
  line_allocations jsonb NOT NULL DEFAULT '[]'::jsonb,
  applied_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (amount_off >= 0),
  CHECK (jsonb_typeof(line_allocations) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_ooa_order
  ON public.order_offer_applications(order_id);
CREATE INDEX IF NOT EXISTS idx_ooa_offer
  ON public.order_offer_applications(offer_id);
CREATE INDEX IF NOT EXISTS idx_ooa_affiliate
  ON public.order_offer_applications(affiliate_id) WHERE affiliate_id IS NOT NULL;

ALTER TABLE public.order_offer_applications ENABLE ROW LEVEL SECURITY;

-- Admins see everything; customers see their own orders' applications.
CREATE POLICY "ooa_select_admin"
  ON public.order_offer_applications FOR SELECT TO authenticated
  USING (public.has_permission('manage:discounts'));
CREATE POLICY "ooa_select_own"
  ON public.order_offer_applications FOR SELECT TO authenticated
  USING (order_id IN (
    SELECT id FROM public.orders WHERE customer_id IN (
      SELECT id FROM public.customers WHERE auth_user_id = auth.uid()
    )
  ));
-- Writes only via the placeOrder server action (admin client). RLS
-- permits but the application layer is the only legitimate writer.
CREATE POLICY "ooa_admin_write"
  ON public.order_offer_applications FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('manage:discounts'));

COMMENT ON TABLE public.order_offer_applications IS
'Source of truth for what offer applied to what order. Required for affiliate commission calc, ROI per offer, dispute resolution, and refund proration (Phase 7). The line_allocations jsonb pre-positions refund math so we can reverse the right amount per returned item.';

-- ---------------------------------------------------------------------------
-- Trigger: keep offers.updated_at fresh on update
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.offers_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_offers_touch_updated_at ON public.offers;
CREATE TRIGGER trg_offers_touch_updated_at
  BEFORE UPDATE ON public.offers
  FOR EACH ROW
  EXECUTE FUNCTION public.offers_touch_updated_at();

-- ---------------------------------------------------------------------------
-- New RBAC permission slot for affiliates is NOT created — manage:discounts
-- covers both offers and affiliates (admins managing one almost always
-- manage the other; an extra permission slot adds complexity without value
-- at this scale). If/when a finer split is needed, a future migration
-- can introduce 'manage:affiliates' and update the RLS policies above.
-- ---------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';
