-- =============================================================================
-- Custom Fields engine — schema (Phase 8a)
--
-- Per-product (or per-category / per-variant) customer-input fields that gate
-- add-to-cart and optionally adjust price. Examples: gift card message,
-- engraving font, baptism baby gender.
--
-- ARCHITECTURE
--
-- Two layers + an order-persistence sink:
--
--   LIBRARY   custom_fields              definitions (label, type, validation,
--                                        edit policy, per-unit flag)
--             custom_field_values        per-value config (label, modifier,
--                                        message, sub-field triggers) — ONLY for
--                                        deterministic types (boolean/dropdown/
--                                        multi_select); text/number have no rows
--             custom_field_value_subfields  depth-1 conditional sub-field links
--             custom_field_groups        named bundles of fields
--             custom_field_group_members
--
--   BINDINGS  custom_field_bindings      "field F or group G applies on
--                                        scope (category|product|variant)"
--                                        with per-binding override_required
--
--   ORDERS    order_item_custom_fields   frozen values + locked-in modifier
--                                        prices per order line (and optionally
--                                        per unit when the field is per_unit)
--
-- PRICING RULES (locked in design phase)
--
--   1) Modifiers stack: every active value-modifier contributes (Boolean true,
--      every selected option in a multi-select, every member-field of a group).
--   2) Modifiers are NEVER discounted by offers — they sit on top of the
--      discounted base price.
--   3) Percent modifiers compute against the ORIGINAL base price (pre-discount)
--      so the customer's "+10% premium fabric" doesn't shrink under coupons.
--
-- EDIT POLICY
--
--   The customer never edits values after payment (locked).
--   The admin can edit fields with edit_policy='admin_until_dispatch' from
--   the order panel, until the order's status flips to dispatched.
--   Fields with edit_policy='frozen' lock at the moment of payment.
--
-- LOCALIZATION
--
--   All admin-and-customer-facing strings (field labels, group names, dropdown
--   option labels, display messages) live in jsonb { el: "...", en: "..." }
--   from day 1. Greek values are the only required ones at launch.
-- =============================================================================

-- ─── 1. custom_fields ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.custom_fields (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                  text NOT NULL UNIQUE,
  -- { el: "Στυλ χάραξης", en: "Engraving font" }
  label_translations   jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_type            text NOT NULL,
  required_default     boolean NOT NULL DEFAULT false,
  visible              boolean NOT NULL DEFAULT true,
  -- per_unit=true → field collected once per unit when qty > 1.
  -- per_unit=false → field collected once per cart line regardless of qty.
  per_unit             boolean NOT NULL DEFAULT false,
  -- Per-type validation: text → {maxLength, regex?}; number → {min, max, step,
  -- integerOnly}; multi_select → {minSelections, maxSelections}; others → {}.
  validation           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 'frozen'                → locked the moment payment succeeds
  -- 'admin_until_dispatch'  → admin can edit until order dispatched
  edit_policy          text NOT NULL DEFAULT 'frozen',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,

  CHECK (data_type IN ('text', 'number', 'boolean', 'dropdown', 'multi_select')),
  CHECK (edit_policy IN ('frozen', 'admin_until_dispatch')),
  CHECK (jsonb_typeof(label_translations) = 'object'),
  CHECK (jsonb_typeof(validation) = 'object'),
  CHECK (length(key) BETWEEN 1 AND 100),
  CHECK (key ~ '^[a-z][a-z0-9_]*$')
);
CREATE INDEX IF NOT EXISTS idx_custom_fields_data_type
  ON public.custom_fields(data_type);
CREATE INDEX IF NOT EXISTS idx_custom_fields_visible
  ON public.custom_fields(visible) WHERE visible = true;

COMMENT ON TABLE public.custom_fields IS
'Library of reusable per-line custom fields. Bound to category/product/variant scopes via custom_field_bindings.';
COMMENT ON COLUMN public.custom_fields.per_unit IS
'When true, the field is collected per unit (qty=3 → 3 values). When false, once per cart line.';
COMMENT ON COLUMN public.custom_fields.edit_policy IS
'Post-payment edit window: ''frozen'' (locked at payment) | ''admin_until_dispatch'' (admin can edit until dispatch).';

-- ─── 2. custom_field_values ──────────────────────────────────────────
-- Per-value config for deterministic types only. A boolean has 2 rows
-- (true, false); a dropdown has N rows (one per option); a multi_select
-- has N rows (one per selectable option). Text/number fields have ZERO rows.
CREATE TABLE IF NOT EXISTS public.custom_field_values (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id              uuid NOT NULL REFERENCES public.custom_fields(id) ON DELETE CASCADE,
  -- For boolean: true/false (as jsonb). For dropdown/multi_select: string key.
  value                 jsonb NOT NULL,
  -- Customer-facing label for this option. Empty for boolean (use field label
  -- + Ναι/Όχι rendering convention).
  label_translations    jsonb NOT NULL DEFAULT '{}'::jsonb,
  modifier_kind         text NOT NULL DEFAULT 'none',
  -- For 'flat': euros; for 'percent': fraction (0.10 = 10%) of original base.
  modifier_amount       numeric(10, 4) NOT NULL DEFAULT 0,
  -- Optional display message shown to the customer when this value is picked.
  -- { el: "Pink ribbon included", en: "..." } | null
  message_translations  jsonb,
  sort_order            integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),

  CHECK (modifier_kind IN ('none', 'flat', 'percent')),
  CHECK (jsonb_typeof(label_translations) = 'object'),
  CHECK (message_translations IS NULL OR jsonb_typeof(message_translations) = 'object'),
  -- Same value can't repeat within one field.
  UNIQUE (field_id, value)
);
CREATE INDEX IF NOT EXISTS idx_custom_field_values_field
  ON public.custom_field_values(field_id, sort_order);

COMMENT ON TABLE public.custom_field_values IS
'Per-value config (label/modifier/message) for deterministic field types. Text/number fields have no rows here.';

-- ─── 3. custom_field_value_subfields ─────────────────────────────────
-- Depth-1 conditional sub-fields. When parent's value matches the row, the
-- listed child_field_id activates on the storefront. Cap at 1 level by
-- design — child fields cannot themselves act as parents.
CREATE TABLE IF NOT EXISTS public.custom_field_value_subfields (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_value_id uuid NOT NULL REFERENCES public.custom_field_values(id) ON DELETE CASCADE,
  child_field_id  uuid NOT NULL REFERENCES public.custom_fields(id) ON DELETE CASCADE,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (parent_value_id, child_field_id)
);
CREATE INDEX IF NOT EXISTS idx_custom_field_value_subfields_parent
  ON public.custom_field_value_subfields(parent_value_id, sort_order);

COMMENT ON TABLE public.custom_field_value_subfields IS
'Depth-1 sub-field triggers: when the parent value is selected, list of child fields that activate. Child fields must not themselves have sub-field rows (enforced in app logic for now).';

-- ─── 4. custom_field_groups ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.custom_field_groups (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_translations   jsonb NOT NULL DEFAULT '{}'::jsonb,
  description         text,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,

  CHECK (jsonb_typeof(name_translations) = 'object')
);

COMMENT ON TABLE public.custom_field_groups IS
'Reusable bundles of custom fields. Bind a group via custom_field_bindings.group_id to apply all its members at once.';

-- ─── 5. custom_field_group_members ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.custom_field_group_members (
  group_id    uuid NOT NULL REFERENCES public.custom_field_groups(id) ON DELETE CASCADE,
  field_id    uuid NOT NULL REFERENCES public.custom_fields(id) ON DELETE CASCADE,
  sort_order  integer NOT NULL DEFAULT 0,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, field_id)
);
CREATE INDEX IF NOT EXISTS idx_custom_field_group_members_group
  ON public.custom_field_group_members(group_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_custom_field_group_members_field
  ON public.custom_field_group_members(field_id);

-- ─── 6. custom_field_bindings ────────────────────────────────────────
-- Polymorphic: each row binds EITHER a field OR a group to ONE scope target.
CREATE TABLE IF NOT EXISTS public.custom_field_bindings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id            uuid REFERENCES public.custom_fields(id) ON DELETE CASCADE,
  group_id            uuid REFERENCES public.custom_field_groups(id) ON DELETE CASCADE,
  scope_kind          text NOT NULL,
  scope_resource_id   uuid NOT NULL,
  active              boolean NOT NULL DEFAULT true,
  -- NULL → use the field's required_default. Boolean → override per binding.
  override_required   boolean,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,

  CHECK (scope_kind IN ('category', 'product', 'variant')),
  -- Exactly one of field_id, group_id is set.
  CHECK ((field_id IS NOT NULL) <> (group_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_custom_field_bindings_scope
  ON public.custom_field_bindings(scope_kind, scope_resource_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_custom_field_bindings_field
  ON public.custom_field_bindings(field_id) WHERE field_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_custom_field_bindings_group
  ON public.custom_field_bindings(group_id) WHERE group_id IS NOT NULL;

-- Two distinct unique constraints — one per binding kind. Without WHERE
-- clauses, a single 4-column unique would collide because NULLs are treated
-- as distinct. Splitting expresses intent: "you can bind the same field to
-- the same scope only once", same for groups.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_field_binding_per_scope
  ON public.custom_field_bindings(field_id, scope_kind, scope_resource_id)
  WHERE field_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_group_binding_per_scope
  ON public.custom_field_bindings(group_id, scope_kind, scope_resource_id)
  WHERE group_id IS NOT NULL;

COMMENT ON TABLE public.custom_field_bindings IS
'Polymorphic field/group binding to category/product/variant scopes. Active rows are evaluated at storefront resolution time. override_required NULL inherits the field default.';

-- ─── 7. order_item_custom_fields ─────────────────────────────────────
-- Per-order-line snapshot of customer-submitted values. Frozen at checkout
-- with the modifier amount that was in effect at the time, so later changes
-- to the field library don't retroactively affect past orders.
CREATE TABLE IF NOT EXISTS public.order_item_custom_fields (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id      uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  field_id           uuid NOT NULL REFERENCES public.custom_fields(id) ON DELETE RESTRICT,
  -- For per_unit=true fields: 0..qty-1. NULL for per-line fields.
  unit_index         integer,
  -- Customer-submitted value (free-form jsonb to handle all data types).
  value              jsonb NOT NULL,
  -- Locked-in modifier price contribution. For boolean/dropdown/multi_select,
  -- this is the sum of all triggered values' modifiers, resolved at checkout
  -- and frozen here.
  contributed_price  numeric(10, 2) NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CHECK (unit_index IS NULL OR unit_index >= 0),
  -- One row per (line, field, unit). NULL unit_index treated as a single
  -- canonical row per (line, field) — Postgres treats NULLs as distinct, so
  -- we coalesce in the unique index expression below.
  UNIQUE (order_item_id, field_id, unit_index)
);
CREATE INDEX IF NOT EXISTS idx_order_item_custom_fields_line
  ON public.order_item_custom_fields(order_item_id);
CREATE INDEX IF NOT EXISTS idx_order_item_custom_fields_field
  ON public.order_item_custom_fields(field_id);

COMMENT ON TABLE public.order_item_custom_fields IS
'Per-line snapshot of customer-submitted custom-field values + frozen modifier price. Source of truth for fulfillment; never recomputed retroactively.';

-- ─── Triggers: updated_at maintenance ────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_custom_fields_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_custom_fields_touch ON public.custom_fields;
CREATE TRIGGER trg_custom_fields_touch
  BEFORE UPDATE ON public.custom_fields
  FOR EACH ROW EXECUTE FUNCTION public.touch_custom_fields_updated_at();

DROP TRIGGER IF EXISTS trg_custom_field_groups_touch ON public.custom_field_groups;
CREATE TRIGGER trg_custom_field_groups_touch
  BEFORE UPDATE ON public.custom_field_groups
  FOR EACH ROW EXECUTE FUNCTION public.touch_custom_fields_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────
-- The library/binding layer is admin-only. The storefront resolution reads
-- through admin-side server actions, not directly via anon role, so anon
-- SELECT is allowed only for `visible = true` fields and active bindings.
-- order_item_custom_fields rows are read by the order owner (their own
-- orders) + by admins; written only by checkout server actions running as
-- the service-role admin client.

ALTER TABLE public.custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_field_value_subfields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_field_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_field_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_field_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_custom_fields ENABLE ROW LEVEL SECURITY;

-- Admin full access on the library/binding layer.
CREATE POLICY "custom_fields_admin_all"
  ON public.custom_fields FOR ALL TO authenticated
  USING (public.has_permission('manage:products'))
  WITH CHECK (public.has_permission('manage:products'));

CREATE POLICY "custom_field_values_admin_all"
  ON public.custom_field_values FOR ALL TO authenticated
  USING (public.has_permission('manage:products'))
  WITH CHECK (public.has_permission('manage:products'));

CREATE POLICY "custom_field_value_subfields_admin_all"
  ON public.custom_field_value_subfields FOR ALL TO authenticated
  USING (public.has_permission('manage:products'))
  WITH CHECK (public.has_permission('manage:products'));

CREATE POLICY "custom_field_groups_admin_all"
  ON public.custom_field_groups FOR ALL TO authenticated
  USING (public.has_permission('manage:products'))
  WITH CHECK (public.has_permission('manage:products'));

CREATE POLICY "custom_field_group_members_admin_all"
  ON public.custom_field_group_members FOR ALL TO authenticated
  USING (public.has_permission('manage:products'))
  WITH CHECK (public.has_permission('manage:products'));

CREATE POLICY "custom_field_bindings_admin_all"
  ON public.custom_field_bindings FOR ALL TO authenticated
  USING (public.has_permission('manage:products'))
  WITH CHECK (public.has_permission('manage:products'));

-- Anon + authenticated can read visible fields (storefront rendering).
CREATE POLICY "custom_fields_storefront_select"
  ON public.custom_fields FOR SELECT TO anon, authenticated
  USING (visible = true);

CREATE POLICY "custom_field_values_storefront_select"
  ON public.custom_field_values FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.custom_fields f
    WHERE f.id = field_id AND f.visible = true
  ));

CREATE POLICY "custom_field_value_subfields_storefront_select"
  ON public.custom_field_value_subfields FOR SELECT TO anon, authenticated
  USING (true); -- linked fields are themselves visibility-gated

CREATE POLICY "custom_field_groups_storefront_select"
  ON public.custom_field_groups FOR SELECT TO anon, authenticated
  USING (active = true);

CREATE POLICY "custom_field_group_members_storefront_select"
  ON public.custom_field_group_members FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.custom_field_groups g
    WHERE g.id = group_id AND g.active = true
  ));

CREATE POLICY "custom_field_bindings_storefront_select"
  ON public.custom_field_bindings FOR SELECT TO anon, authenticated
  USING (active = true);

-- Order-line custom fields: order owner OR admin.
-- The orders table dropped its `user_id` column in 20260518000001 in
-- favour of `customer_id` → `customers.auth_user_id`, so this policy
-- traverses the customers chain rather than reading orders.user_id
-- directly (which no longer exists).
CREATE POLICY "order_item_custom_fields_owner_select"
  ON public.order_item_custom_fields FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.order_items ol
    JOIN public.orders o ON o.id = ol.order_id
    JOIN public.customers c ON c.id = o.customer_id
    WHERE ol.id = order_item_id
      AND c.auth_user_id = auth.uid()
  ));

CREATE POLICY "order_item_custom_fields_admin_select"
  ON public.order_item_custom_fields FOR SELECT TO authenticated
  USING (public.has_permission('manage:orders'));

CREATE POLICY "order_item_custom_fields_admin_write"
  ON public.order_item_custom_fields FOR ALL TO authenticated
  USING (public.has_permission('manage:orders'))
  WITH CHECK (public.has_permission('manage:orders'));
