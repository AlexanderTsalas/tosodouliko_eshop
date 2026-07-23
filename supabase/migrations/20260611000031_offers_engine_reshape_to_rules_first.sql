-- =============================================================================
-- Offers engine v2 — schema reshape: rules become first-class.
--
-- Reverses the parent-child relationship from v1:
--   v1: offers carry conditionals + scopes + codes; rules are just "actions"
--   v2: RULES carry name + conditionals + scopes + codes + active flag;
--       offers are slim labels (name + description + active) that group
--       rules via a M2M junction
--
-- Why: matches the admin's mental model — they create rules first (each
-- rule does ONE thing with its own conditions), then optionally group
-- them under offers for semantic clarity ("Black Friday 2025 = these 4
-- rules"). Disabling an offer cascades to all child rules.
--
-- M2M: a rule can belong to multiple offers (per decision Q1 round 4).
-- A rule applies in the engine iff:
--   rule.active = true AND
--   (rule has no parent offers OR at least one parent offer.active = true)
--
-- Defaults (decision Q6):
--   rules.active DEFAULT false (safety — admin must explicitly enable)
--   offers.active DEFAULT true (empty offer can't fire anything anyway)
--
-- This migration is destructive (drops several v1 tables) but the only
-- data lost is the conditionals we duplicate down into rules during
-- backfill. Safe because we shipped v1 yesterday + production data is
-- only the backfilled-from-legacy rows.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: hydrate offer_rules with the conditional columns + name/description
-- ---------------------------------------------------------------------------
ALTER TABLE public.offer_rules
  ADD COLUMN name                  text,
  ADD COLUMN description           text,
  ADD COLUMN starts_at             timestamptz,
  ADD COLUMN ends_at               timestamptz,
  ADD COLUMN user_type             text NOT NULL DEFAULT 'any',
  ADD COLUMN requires_code         boolean NOT NULL DEFAULT false,
  ADD COLUMN min_subtotal          numeric(10,2),
  ADD COLUMN min_item_count        integer,
  ADD COLUMN stacking_mode         text NOT NULL DEFAULT 'exclusive_within_kind',
  ADD COLUMN priority              integer NOT NULL DEFAULT 0,
  ADD COLUMN max_uses_total        integer,
  ADD COLUMN max_uses_per_customer integer,
  ADD COLUMN current_uses          integer NOT NULL DEFAULT 0,
  ADD COLUMN enforce_limits        boolean NOT NULL DEFAULT false,
  ADD COLUMN stock_threshold       integer,
  ADD COLUMN stock_scope_kind      text,
  ADD COLUMN stock_scope_id        uuid;

-- Step 2: backfill from parent offer.
UPDATE public.offer_rules r
SET
  name = COALESCE(o.name, 'Rule ' || substr(r.id::text, 1, 8)),
  description = o.description,
  starts_at = o.starts_at,
  ends_at = o.ends_at,
  user_type = o.user_type,
  requires_code = o.requires_code,
  min_subtotal = o.min_subtotal,
  min_item_count = o.min_item_count,
  stacking_mode = o.stacking_mode,
  priority = o.priority,
  max_uses_total = o.max_uses_total,
  max_uses_per_customer = o.max_uses_per_customer,
  current_uses = o.current_uses,
  enforce_limits = o.enforce_limits,
  stock_threshold = o.stock_threshold,
  stock_scope_kind = o.stock_scope_kind,
  stock_scope_id = o.stock_scope_id
FROM public.offers o
WHERE r.offer_id = o.id;

-- Step 3: lock in the new column constraints.
ALTER TABLE public.offer_rules
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN active SET DEFAULT false;  -- Q6 safety default for new rows

ALTER TABLE public.offer_rules
  ADD CONSTRAINT rules_user_type_chk
    CHECK (user_type IN ('any','authenticated','guest')),
  ADD CONSTRAINT rules_stacking_mode_chk
    CHECK (stacking_mode IN ('stack','exclusive_within_kind','global_exclusive')),
  ADD CONSTRAINT rules_stock_scope_pair_chk
    CHECK ((stock_threshold IS NULL) = (stock_scope_id IS NULL)),
  ADD CONSTRAINT rules_stock_scope_kind_chk
    CHECK (stock_scope_kind IS NULL OR stock_scope_kind IN ('variant','product')),
  ADD CONSTRAINT rules_stock_pair_chk
    CHECK (stock_threshold IS NULL OR stock_scope_kind IS NOT NULL),
  ADD CONSTRAINT rules_time_window_chk
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  ADD CONSTRAINT rules_min_subtotal_chk
    CHECK (min_subtotal IS NULL OR min_subtotal >= 0),
  ADD CONSTRAINT rules_min_item_count_chk
    CHECK (min_item_count IS NULL OR min_item_count > 0),
  ADD CONSTRAINT rules_max_uses_total_chk
    CHECK (max_uses_total IS NULL OR max_uses_total > 0),
  ADD CONSTRAINT rules_max_uses_per_customer_chk
    CHECK (max_uses_per_customer IS NULL OR max_uses_per_customer > 0),
  ADD CONSTRAINT rules_current_uses_chk
    CHECK (current_uses >= 0);

-- ---------------------------------------------------------------------------
-- Step 4: M2M junction — offer_rule_memberships
-- ---------------------------------------------------------------------------
CREATE TABLE public.offer_rule_memberships (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id  uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  rule_id   uuid NOT NULL REFERENCES public.offer_rules(id) ON DELETE CASCADE,
  added_at  timestamptz NOT NULL DEFAULT now(),
  added_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (offer_id, rule_id)
);
CREATE INDEX idx_orm_offer ON public.offer_rule_memberships(offer_id);
CREATE INDEX idx_orm_rule ON public.offer_rule_memberships(rule_id);

ALTER TABLE public.offer_rule_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orm_admin_write"
  ON public.offer_rule_memberships FOR ALL TO authenticated
  USING (public.has_permission('manage:discounts'))
  WITH CHECK (public.has_permission('manage:discounts'));
CREATE POLICY "orm_select_storefront_safe"
  ON public.offer_rule_memberships FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.offers o
    WHERE o.id = offer_id AND o.active = true
  ));
CREATE POLICY "orm_select_admin_all"
  ON public.offer_rule_memberships FOR SELECT TO authenticated
  USING (public.has_permission('manage:discounts'));

-- Backfill memberships from the current 1-1 FK.
INSERT INTO public.offer_rule_memberships (offer_id, rule_id)
SELECT offer_id, id FROM public.offer_rules
WHERE offer_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Step 5: rule_scopes (each rule carries its own scopes)
-- ---------------------------------------------------------------------------
CREATE TABLE public.rule_scopes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id      uuid NOT NULL REFERENCES public.offer_rules(id) ON DELETE CASCADE,
  scope_kind   text NOT NULL,
  resource_id  uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (scope_kind IN ('all','category','product','variant')),
  CHECK ((scope_kind = 'all') = (resource_id IS NULL))
);
CREATE INDEX idx_rule_scopes_rule ON public.rule_scopes(rule_id);
CREATE INDEX idx_rule_scopes_resource ON public.rule_scopes(scope_kind, resource_id);

ALTER TABLE public.rule_scopes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rule_scopes_admin_write"
  ON public.rule_scopes FOR ALL TO authenticated
  USING (public.has_permission('manage:discounts'))
  WITH CHECK (public.has_permission('manage:discounts'));
CREATE POLICY "rule_scopes_select_storefront_safe"
  ON public.rule_scopes FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.offer_rules r
    WHERE r.id = rule_id AND r.active = true AND r.requires_code = false
  ));
CREATE POLICY "rule_scopes_select_admin_all"
  ON public.rule_scopes FOR SELECT TO authenticated
  USING (public.has_permission('manage:discounts'));

-- Backfill: each rule inherits every scope of its current parent offer.
INSERT INTO public.rule_scopes (rule_id, scope_kind, resource_id)
SELECT r.id, s.scope_kind, s.resource_id
FROM public.offer_rules r
JOIN public.offer_scopes s ON s.offer_id = r.offer_id
WHERE r.offer_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Step 6: rule_codes (each rule carries its own codes; UNIQUE on
-- (code, rule_id) so the same code text can fire multiple rules)
-- ---------------------------------------------------------------------------
CREATE TABLE public.rule_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id       uuid NOT NULL REFERENCES public.offer_rules(id) ON DELETE CASCADE,
  code          text NOT NULL,
  affiliate_id  uuid REFERENCES public.affiliates(id) ON DELETE SET NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (code, rule_id)
);
CREATE INDEX idx_rule_codes_code ON public.rule_codes(code);
CREATE INDEX idx_rule_codes_rule ON public.rule_codes(rule_id);
CREATE INDEX idx_rule_codes_affiliate ON public.rule_codes(affiliate_id)
  WHERE affiliate_id IS NOT NULL;

ALTER TABLE public.rule_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rule_codes_admin_write"
  ON public.rule_codes FOR ALL TO authenticated
  USING (public.has_permission('manage:discounts'))
  WITH CHECK (public.has_permission('manage:discounts'));
-- Public read open for code-validation (customer enters code at checkout).
CREATE POLICY "rule_codes_select_public"
  ON public.rule_codes FOR SELECT TO anon, authenticated
  USING (true);

-- Backfill: each rule of an offer gets all the offer's codes.
INSERT INTO public.rule_codes (rule_id, code, affiliate_id, active, created_at, created_by)
SELECT r.id, oc.code, oc.affiliate_id, oc.active, oc.created_at, oc.created_by
FROM public.offer_rules r
JOIN public.offer_codes oc ON oc.offer_id = r.offer_id
WHERE r.offer_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Step 7: rule_code_customers (whitelist per code-row, not per code-text)
-- ---------------------------------------------------------------------------
CREATE TABLE public.rule_code_customers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_code_id    uuid NOT NULL REFERENCES public.rule_codes(id) ON DELETE CASCADE,
  customer_id     uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  auto_apply      boolean NOT NULL DEFAULT false,
  added_at        timestamptz NOT NULL DEFAULT now(),
  added_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (rule_code_id, customer_id)
);
CREATE INDEX idx_rcc_code ON public.rule_code_customers(rule_code_id);
CREATE INDEX idx_rcc_customer ON public.rule_code_customers(customer_id);
CREATE INDEX idx_rcc_customer_auto_apply
  ON public.rule_code_customers(customer_id)
  WHERE auto_apply = true;

ALTER TABLE public.rule_code_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rcc_admin_write"
  ON public.rule_code_customers FOR ALL TO authenticated
  USING (public.has_permission('manage:discounts'))
  WITH CHECK (public.has_permission('manage:discounts'));
CREATE POLICY "rcc_select_own"
  ON public.rule_code_customers FOR SELECT TO authenticated
  USING (
    customer_id IN (SELECT id FROM public.customers WHERE auth_user_id = auth.uid())
    OR public.has_permission('manage:discounts')
  );

-- Backfill: for each (offer_code_customer) row, find ALL rule_codes
-- rows that correspond to (offer_id, code) and create restrictions on
-- each. Compound JOIN to map the v1 single row to the v2 per-rule rows.
INSERT INTO public.rule_code_customers (rule_code_id, customer_id, auto_apply, added_at, added_by)
SELECT rc.id, occ.customer_id, occ.auto_apply, occ.added_at, occ.added_by
FROM public.offer_code_customers occ
JOIN public.offer_codes oc ON oc.id = occ.offer_code_id
JOIN public.rule_codes rc
  ON rc.code = oc.code
 AND rc.rule_id IN (SELECT id FROM public.offer_rules WHERE offer_id = oc.offer_id);

-- ---------------------------------------------------------------------------
-- Step 8: rule_customer_usage (per-rule per-customer counter)
-- ---------------------------------------------------------------------------
CREATE TABLE public.rule_customer_usage (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id       uuid NOT NULL REFERENCES public.offer_rules(id) ON DELETE CASCADE,
  customer_id   uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  use_count     integer NOT NULL DEFAULT 0,
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, customer_id),
  CHECK (use_count >= 0)
);
CREATE INDEX idx_rcu_customer ON public.rule_customer_usage(customer_id);

ALTER TABLE public.rule_customer_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rcu_admin_read"
  ON public.rule_customer_usage FOR SELECT TO authenticated
  USING (public.has_permission('manage:discounts'));
CREATE POLICY "rcu_select_own"
  ON public.rule_customer_usage FOR SELECT TO authenticated
  USING (customer_id IN (
    SELECT id FROM public.customers WHERE auth_user_id = auth.uid()
  ));

-- Backfill: each rule of an offer inherits the offer's usage counters.
-- Note: this duplicates counts across rules of the same offer; v1's
-- counter was per-offer, v2's is per-rule. This is acceptable for
-- backfill (counts are denorm; engine reads enforce_limits + max_uses_*
-- against current_uses anyway). Reset to 0 in production if exact
-- attribution matters.
INSERT INTO public.rule_customer_usage (rule_id, customer_id, use_count, last_used_at)
SELECT r.id, ocu.customer_id, ocu.use_count, ocu.last_used_at
FROM public.offer_rules r
JOIN public.offer_customer_usage ocu ON ocu.offer_id = r.offer_id
WHERE r.offer_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Step 9: order_rule_applications (rename + reshape order_offer_applications)
-- offer_id becomes NULLABLE since rules may have multiple parents or none.
--
-- Also handles the code_id FK: it currently points at offer_codes which we're
-- about to drop. The legacy backfilled rows reference offer_codes UUIDs that
-- don't map cleanly to the new rule_codes IDs (rule_codes was re-created
-- from scratch in Step 7 with new UUIDs). Solution:
--   - Drop the old FK to offer_codes
--   - Wipe code_id on existing rows (audit trail loses code attribution for
--     legacy-backfilled rows — acceptable since those were historical
--     discount_usage records with no production value)
--   - Re-add the FK pointing at rule_codes for the v2 lifecycle
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.order_offer_applications
  RENAME TO order_rule_applications;
ALTER TABLE public.order_rule_applications
  ALTER COLUMN offer_id DROP NOT NULL;

-- Drop the old FK + wipe code_id. The FK constraint name follows Postgres's
-- default pattern from the parent table's original name (order_offer_*),
-- which Supabase preserved across the rename.
ALTER TABLE public.order_rule_applications
  DROP CONSTRAINT IF EXISTS order_offer_applications_code_id_fkey;
UPDATE public.order_rule_applications SET code_id = NULL;

COMMENT ON COLUMN public.order_rule_applications.offer_id IS
'Optional: the offer the rule was associated with at audit time. NULL when the rule had no parent offer. Many-to-many means this captures one of possibly several; full membership history lives in offer_rule_memberships.';

-- ---------------------------------------------------------------------------
-- Step 10: drop the now-orphaned v1 tables + columns
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.offer_code_customers;
DROP TABLE IF EXISTS public.offer_codes;
DROP TABLE IF EXISTS public.offer_scopes;
DROP TABLE IF EXISTS public.offer_customer_usage;

-- Re-add the code_id FK pointing at the new rule_codes table.
ALTER TABLE public.order_rule_applications
  ADD CONSTRAINT order_rule_applications_code_id_fkey
  FOREIGN KEY (code_id) REFERENCES public.rule_codes(id) ON DELETE SET NULL;

-- offer_rules.offer_id FK column → drop (the parent reference is now via
-- memberships). The legacy storefront-safe RLS policy references
-- offer_id via its EXISTS subquery; we drop it here and re-create it
-- with v2 OR-of-parents logic after the table rename (Step 11). The
-- admin-write + admin-all policies stay; they reference permissions,
-- not the column being dropped.
DROP POLICY IF EXISTS offer_rules_select_storefront_safe ON public.offer_rules;
ALTER TABLE public.offer_rules DROP COLUMN IF EXISTS offer_id;

-- ---------------------------------------------------------------------------
-- Step 11: rename offer_rules → rules (semantic clarity)
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.offer_rules RENAME TO rules;

-- v2 storefront-safe policy: a rule is publicly visible iff
--   1. active = true
--   2. requires_code = false (storefront only sees auto-apply rules)
--   3. OR-of-parents: no offer_rule_memberships rows for this rule,
--      OR at least one parent offer is active
CREATE POLICY "rules_select_storefront_safe"
  ON public.rules FOR SELECT TO anon, authenticated
  USING (
    active = true
    AND requires_code = false
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.offer_rule_memberships orm
        WHERE orm.rule_id = public.rules.id
      )
      OR EXISTS (
        SELECT 1 FROM public.offer_rule_memberships orm
        JOIN public.offers o ON o.id = orm.offer_id
        WHERE orm.rule_id = public.rules.id AND o.active = true
      )
    )
  );

-- The CHECK constraint names start with "rules_" already, no rename needed.
-- Indexes follow the table rename automatically.
-- RLS policies stay (Postgres associates them with the table, not its
-- name).

-- ---------------------------------------------------------------------------
-- Step 12: slim the offers table — drop everything that moved to rules
--
-- The legacy offers_select_storefront_safe policy references the
-- requires_code column we're about to drop; same pattern as Step 10's
-- handling of offer_rules. Drop the policy first, drop the columns,
-- then recreate the policy with v2-only logic (active flag only —
-- offers are now slim labels and don't have eligibility conditionals).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS offers_select_storefront_safe ON public.offers;

-- Drop the time-window index that's no longer relevant on offers.
DROP INDEX IF EXISTS public.idx_offers_active_time_window;

ALTER TABLE public.offers
  DROP COLUMN IF EXISTS starts_at,
  DROP COLUMN IF EXISTS ends_at,
  DROP COLUMN IF EXISTS user_type,
  DROP COLUMN IF EXISTS requires_code,
  DROP COLUMN IF EXISTS min_subtotal,
  DROP COLUMN IF EXISTS min_item_count,
  DROP COLUMN IF EXISTS stacking_mode,
  DROP COLUMN IF EXISTS priority,
  DROP COLUMN IF EXISTS max_uses_total,
  DROP COLUMN IF EXISTS max_uses_per_customer,
  DROP COLUMN IF EXISTS current_uses,
  DROP COLUMN IF EXISTS enforce_limits,
  DROP COLUMN IF EXISTS stock_threshold,
  DROP COLUMN IF EXISTS stock_scope_kind,
  DROP COLUMN IF EXISTS stock_scope_id;

-- Offers default-active per Q6.
ALTER TABLE public.offers ALTER COLUMN active SET DEFAULT true;

-- v2 storefront-safe policy: an offer is publicly visible iff active.
-- The eligibility conditionals (time, user_type, code requirement, etc.)
-- live on rules now; the storefront-safe gate for rules already checks
-- the OR-of-parents (see Step 11). So all we need to expose at offer
-- level is the existence of an active offer.
CREATE POLICY "offers_select_storefront_safe"
  ON public.offers FOR SELECT TO anon, authenticated
  USING (active = true);

COMMENT ON TABLE public.offers IS
'Slim grouping label per v2 (decision Q1-Q6 round 4). An offer carries name + description + active flag and aggregates rules via offer_rule_memberships. Conditionals (time, user_type, scopes, codes, limits) live on RULES; offer.active acts as a master switch that cascades to all member rules.';

-- ---------------------------------------------------------------------------
-- Step 13: refresh comments on the (newly renamed) tables
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.rules IS
'First-class rule entity per v2. Each rule carries: name + description + active flag + kind + all conditionals (time window, user_type, code requirement, subtotal/item_count thresholds, stock threshold) + stacking_mode + limits. Scopes via rule_scopes; codes via rule_codes; offer memberships via offer_rule_memberships. Default active=false for safety (Q6).';

COMMENT ON COLUMN public.rules.active IS
'Default false (Q6). Engine eval requires rule.active=true AND (no parent offer OR at least one parent offer.active=true).';

COMMENT ON TABLE public.offer_rule_memberships IS
'M2M junction (Q1). A rule can belong to multiple offers; an offer can contain multiple rules. Engine OR-of-parents check: if a rule has any memberships, at least one parent offer must be active for the rule to apply.';

NOTIFY pgrst, 'reload schema';
