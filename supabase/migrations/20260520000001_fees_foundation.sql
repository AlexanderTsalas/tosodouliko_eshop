-- =============================================================================
-- Custom-fee foundation.
--
-- Replaces the implicit "shipping_amount is the only fee" pattern with a
-- proper model:
--
--   * fee_categories — user-defined fee buckets (shipping, COD handling,
--     plus anything the merchant invents). Two are seeded with is_system=true
--     because integration code references them by slug — they can be renamed
--     but not deleted.
--
--   * fee_rules — the actual €/% amounts. Each rule lives at one of four
--     scope levels: global, category, product, or variant. The resolver
--     picks the most-specific matching rule at order time, with "highest
--     wins" semantics when multiple categories share a cart.
--
-- Phase 1 ships the data model for all four scopes, the seeded categories,
-- and the basic admin RLS. The resolver code that actually picks and
-- combines rules ships in app code (src/lib/fees/resolve.ts).
--
-- Why no `cod_fee_amount`-style discrete column on orders? Because the
-- list of fee categories is open-ended — adding "rush delivery" or "weekend
-- service" should not require a schema migration. The fee breakdown lands
-- in a jsonb on orders (next migration). One column, infinite categories.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Permission (admins can configure fees)
-- ---------------------------------------------------------------------------

INSERT INTO public.permissions (name, resource, action, description) VALUES
  ('manage:fees', 'fees', 'manage', 'Create/edit/delete fee categories and rate rules')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'admin' AND p.name = 'manage:fees'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- fee_categories
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fee_categories (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable internal identifier. Integration code (carrier API mappings,
  -- payment flow) references categories by slug, so changing this would
  -- break integrations — the admin UI must not allow editing slug.
  slug              text NOT NULL UNIQUE,
  -- Customer-facing display label. Free to rename anytime.
  label             text NOT NULL,
  description       text,

  -- WHEN this category applies to an order. jsonb with key/value matchers.
  -- ALL matchers must hold for the category to apply. Empty object = always.
  -- Supported keys (Phase 1):
  --   payment_method, delivery_method, carrier, min_subtotal, max_subtotal
  applies_when      jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- WHERE in the receipt this category renders. Also doubles as the
  -- calculation order — categories with lower display_order resolve first,
  -- so percentage rules with percentage_base='subtotal_plus_shipping' can
  -- read shipping's already-computed amount.
  display_order     int NOT NULL DEFAULT 100,

  -- WHAT BASE percentage rules under this category compute against.
  -- Ignored for rate_type='flat' rules.
  --   'order_subtotal'        — items only
  --   'subtotal_plus_shipping' — items + already-resolved 'shipping' category
  --   'cod_amount'            — for COD-specific percentage fees on COD value
  --   'fixed_amount'          — sentinel, not used
  percentage_base   text NOT NULL DEFAULT 'order_subtotal',

  -- Pricing source for this category. Phase 1 only honors 'custom'; 'api'
  -- is wired in Phase 3 when carrier providers ship.
  pricing_source    text NOT NULL DEFAULT 'custom'
    CHECK (pricing_source IN ('custom', 'api')),

  -- System-seeded rows (shipping, cod_handling) can be renamed but not
  -- deleted — integration code references them by slug.
  is_system         boolean NOT NULL DEFAULT false,
  active            boolean NOT NULL DEFAULT true,

  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fee_categories_active_display
  ON public.fee_categories(active, display_order)
  WHERE active = true;

ALTER TABLE public.fee_categories ENABLE ROW LEVEL SECURITY;

-- Customers can read active categories so checkout can render labels for
-- their own order's fees_breakdown. The amounts themselves are on the
-- order — this just lets the UI know "what label does category X show?".
CREATE POLICY "fee_categories_select_public"
  ON public.fee_categories FOR SELECT TO anon, authenticated
  USING (active = true OR public.has_permission('manage:fees'));

CREATE POLICY "fee_categories_admin_write"
  ON public.fee_categories FOR ALL TO authenticated
  USING (public.has_permission('manage:fees'))
  WITH CHECK (public.has_permission('manage:fees'));

-- Seed the two integration-anchored categories.
INSERT INTO public.fee_categories
  (slug, label, applies_when, display_order, percentage_base, is_system)
VALUES
  ('shipping', 'Μεταφορικά',
   '{}'::jsonb, 10, 'order_subtotal', true),
  ('cod_handling', 'Επιβάρυνση αντικαταβολής',
   jsonb_build_object('payment_method', 'cod'), 20, 'subtotal_plus_shipping', true)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- fee_rules
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fee_rules (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_category_id             uuid NOT NULL REFERENCES public.fee_categories(id) ON DELETE CASCADE,

  -- Scope (where this rule applies in the catalog tree).
  scope_type                  text NOT NULL DEFAULT 'global'
    CHECK (scope_type IN ('global', 'category', 'product', 'variant')),
  -- Polymorphic FK — points at categories.id / products.id / product_variants.id
  -- depending on scope_type. NULL only when scope_type='global'.
  -- App layer is responsible for validating the type matches the scope_type;
  -- using polymorphic columns instead of real FKs keeps the schema simple at
  -- the cost of orphan-rule possibility (mitigated by an admin cleanup job).
  scope_id                    uuid,

  rate_type                   text NOT NULL CHECK (rate_type IN ('flat', 'percentage')),
  amount                      numeric(10,4) NOT NULL CHECK (amount >= 0),

  -- Additional filters at the rule level (any/all must match the order).
  -- NULL = applies to all payment methods / delivery methods / carriers.
  applies_to_payment_methods  text[],
  applies_to_delivery_methods text[],
  applies_to_carriers         text[],

  -- Priority resolution: lower number = evaluated first when ranking rules
  -- within the same category. Used when multiple rules of the same scope
  -- match — typically irrelevant since scope_type itself orders things.
  priority                    int NOT NULL DEFAULT 100,

  -- How this rule stacks with less-specific rules of the same category.
  --   'override' (default) — most-specific scope wins (variant > product > category > global)
  --   'add'                — add this amount on top of whatever the parent scope resolved
  combination                 text NOT NULL DEFAULT 'override'
    CHECK (combination IN ('override', 'add')),

  active                      boolean NOT NULL DEFAULT true,
  created_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  -- A rule must either have scope_id set or be the global rule.
  CONSTRAINT fee_rules_scope_id_consistency CHECK (
    (scope_type = 'global' AND scope_id IS NULL)
    OR (scope_type != 'global' AND scope_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_fee_rules_category_active
  ON public.fee_rules(fee_category_id, active)
  WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_fee_rules_scope
  ON public.fee_rules(scope_type, scope_id);

ALTER TABLE public.fee_rules ENABLE ROW LEVEL SECURITY;

-- Customers don't need to see the rules themselves. Their order's
-- fees_breakdown is the source of truth for what they were charged.
CREATE POLICY "fee_rules_admin_select"
  ON public.fee_rules FOR SELECT TO authenticated
  USING (public.has_permission('manage:fees'));

CREATE POLICY "fee_rules_admin_write"
  ON public.fee_rules FOR ALL TO authenticated
  USING (public.has_permission('manage:fees'))
  WITH CHECK (public.has_permission('manage:fees'));

COMMENT ON COLUMN public.fee_rules.combination IS
  '"override" (default): most-specific scope wins. "add": this rule''s amount stacks on top of less-specific rules.';
