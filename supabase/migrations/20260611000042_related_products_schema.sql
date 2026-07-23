-- =============================================================================
-- Related Products engine — schema (Phase 9a)
--
-- Configurable per-product suggestion carousels. Each association pairs a
-- SOURCE filter (matches the product the customer is viewing) with a
-- TARGET filter (selects what to recommend), plus presentation knobs
-- (carousel title, strategy, max results, OOS handling).
--
-- ARCHITECTURE
--
--   ASSOCIATIONS                            ← admin defines
--     related_products_associations         ← title, strategy, priority, ...
--     related_products_filter_groups        ← one or more groups per side
--                                              (OR between groups)
--     related_products_filter_conditions    ← AND within each group
--     related_products_manual_picks         ← curated order when
--                                              strategy = 'manual'
--
-- DESIGN RULES (locked in eval phase)
--
--   1) Boolean composition: groups OR each other; conditions within a
--      group AND together. Together: (A ∧ B) ∨ (C ∧ D).
--   2) Multiple matching associations → up to 3 carousels per page,
--      sorted by priority DESC. Hard cap enforced at the resolver.
--   3) Self-suggestion exclusion is always on (resolver subtracts the
--      viewer's own product from any candidate list).
--   4) Selection strategies shipped in v1: 'random', 'recent', 'manual'.
--      'bestseller' is deferred to a separate feature.
--   5) Card granularity ('product' | 'variant') is per-association so
--      merchants can choose per use case.
--   6) OOS exclusion is per-association, default ON.
-- =============================================================================

-- ─── 1. related_products_associations ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.related_products_associations (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        text NOT NULL,
  -- Customer-facing carousel title per locale. NULL/empty → falls back
  -- to "Προτεινόμενα Προϊόντα" on the storefront.
  message_title_translations  jsonb NOT NULL DEFAULT '{}'::jsonb,
  active                      boolean NOT NULL DEFAULT true,
  -- Higher priority renders first when multiple associations match a page.
  priority                    integer NOT NULL DEFAULT 0,
  -- When true, candidates with zero available stock are filtered out
  -- BEFORE the selection strategy runs.
  exclude_oos                 boolean NOT NULL DEFAULT true,
  selection_strategy          text NOT NULL DEFAULT 'random',
  max_results                 integer NOT NULL DEFAULT 6,
  -- Customer-facing card type. 'product' renders one card per parent
  -- product (preferred). 'variant' renders one card per variant.
  card_granularity            text NOT NULL DEFAULT 'product',
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,

  CHECK (selection_strategy IN ('random', 'recent', 'manual')),
  CHECK (card_granularity IN ('product', 'variant')),
  CHECK (priority >= 0),
  CHECK (max_results BETWEEN 1 AND 24),
  CHECK (length(name) BETWEEN 1 AND 200),
  CHECK (jsonb_typeof(message_title_translations) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_rpa_active_priority
  ON public.related_products_associations(active, priority DESC) WHERE active = true;

COMMENT ON TABLE public.related_products_associations IS
'Top-level per-product suggestion carousel definitions. Each row is one carousel — source filter (when viewer matches) + target filter (what to recommend) live in companion tables.';
COMMENT ON COLUMN public.related_products_associations.message_title_translations IS
'Customer-facing carousel title (jsonb {el, en, ...}). NULL/empty → fallback "Προτεινόμενα Προϊόντα".';
COMMENT ON COLUMN public.related_products_associations.priority IS
'Higher renders first when multiple associations match a single page. The resolver caps at 3 carousels total.';

-- ─── 2. related_products_filter_groups ───────────────────────────────
-- One or more groups per side. Conditions WITHIN a group AND together;
-- groups OR each other. Side is the binding axis (source or target).
CREATE TABLE IF NOT EXISTS public.related_products_filter_groups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_id  uuid NOT NULL REFERENCES public.related_products_associations(id) ON DELETE CASCADE,
  side            text NOT NULL,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CHECK (side IN ('source', 'target'))
);
CREATE INDEX IF NOT EXISTS idx_rpfg_association_side
  ON public.related_products_filter_groups(association_id, side, sort_order);

COMMENT ON TABLE public.related_products_filter_groups IS
'Filter group on one side (source or target) of an association. OR between groups, AND within their conditions.';

-- ─── 3. related_products_filter_conditions ───────────────────────────
-- Per-condition config keyed by `kind`. The condition's shape is
-- documented in the COMMENT below and validated app-side; we don't
-- enforce schema-per-kind at the DB layer to keep migrations stable.
CREATE TABLE IF NOT EXISTS public.related_products_filter_conditions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filter_group_id  uuid NOT NULL REFERENCES public.related_products_filter_groups(id) ON DELETE CASCADE,
  kind             text NOT NULL,
  config           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- When true, the condition is negated: "NOT in category X".
  negate           boolean NOT NULL DEFAULT false,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CHECK (kind IN (
    'category',          -- {category_id, include_descendants}
    'product',           -- {product_id}
    'variant',           -- {variant_id}
    'attribute_value',   -- {attribute_id, value: string}
    'attribute_value_in',-- {attribute_id, values: string[]}
    'attribute_present', -- {attribute_id}
    'tag'                -- {tag: string} — reserved for future tag system
  )),
  CHECK (jsonb_typeof(config) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_rpfc_group
  ON public.related_products_filter_conditions(filter_group_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_rpfc_kind
  ON public.related_products_filter_conditions(kind);

COMMENT ON TABLE public.related_products_filter_conditions IS
'Individual condition row inside a filter group. Conditions in the same group AND together; the negate flag flips one condition''s sense.';

-- ─── 4. related_products_manual_picks ────────────────────────────────
-- Only consulted when association.selection_strategy = 'manual'.
-- Otherwise rows here are ignored. The product picker UI populates this.
CREATE TABLE IF NOT EXISTS public.related_products_manual_picks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_id  uuid NOT NULL REFERENCES public.related_products_associations(id) ON DELETE CASCADE,
  product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sort_order      integer NOT NULL DEFAULT 0,
  added_at        timestamptz NOT NULL DEFAULT now(),

  -- Same product can't be picked twice for the same association.
  UNIQUE (association_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_rpmp_association
  ON public.related_products_manual_picks(association_id, sort_order);

COMMENT ON TABLE public.related_products_manual_picks IS
'Curated pick order for associations with selection_strategy=manual. Rows ignored for other strategies.';

-- ─── updated_at trigger on associations ──────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_related_products_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rpa_touch ON public.related_products_associations;
CREATE TRIGGER trg_rpa_touch
  BEFORE UPDATE ON public.related_products_associations
  FOR EACH ROW EXECUTE FUNCTION public.touch_related_products_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────
-- Library is admin-only via manage:products (same gate as custom-fields).
-- Storefront reads via admin-side server actions / resolver, not anon
-- role directly — but we still allow anon SELECT on active rows so the
-- resolver could run as anon if needed (e.g. edge cache).

ALTER TABLE public.related_products_associations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.related_products_filter_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.related_products_filter_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.related_products_manual_picks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rpa_admin_all"
  ON public.related_products_associations FOR ALL TO authenticated
  USING (public.has_permission('manage:products'))
  WITH CHECK (public.has_permission('manage:products'));

CREATE POLICY "rpfg_admin_all"
  ON public.related_products_filter_groups FOR ALL TO authenticated
  USING (public.has_permission('manage:products'))
  WITH CHECK (public.has_permission('manage:products'));

CREATE POLICY "rpfc_admin_all"
  ON public.related_products_filter_conditions FOR ALL TO authenticated
  USING (public.has_permission('manage:products'))
  WITH CHECK (public.has_permission('manage:products'));

CREATE POLICY "rpmp_admin_all"
  ON public.related_products_manual_picks FOR ALL TO authenticated
  USING (public.has_permission('manage:products'))
  WITH CHECK (public.has_permission('manage:products'));

-- Storefront reads active rows only.
CREATE POLICY "rpa_storefront_select"
  ON public.related_products_associations FOR SELECT TO anon, authenticated
  USING (active = true);

CREATE POLICY "rpfg_storefront_select"
  ON public.related_products_filter_groups FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.related_products_associations a
    WHERE a.id = association_id AND a.active = true
  ));

CREATE POLICY "rpfc_storefront_select"
  ON public.related_products_filter_conditions FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.related_products_filter_groups g
    JOIN public.related_products_associations a ON a.id = g.association_id
    WHERE g.id = filter_group_id AND a.active = true
  ));

CREATE POLICY "rpmp_storefront_select"
  ON public.related_products_manual_picks FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.related_products_associations a
    WHERE a.id = association_id AND a.active = true
  ));
