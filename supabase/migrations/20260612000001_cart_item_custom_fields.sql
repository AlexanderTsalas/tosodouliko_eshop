-- =============================================================================
-- Cart-level custom field persistence (Phase 8g)
--
-- Adds the cart-side mirror of order_item_custom_fields so a customer's
-- custom-field values are preserved from add-to-cart through checkout
-- conversion. Also adds modifier_total to cart_items so the cart
-- subtotal and Stripe payment amount include modifier contributions
-- without recomputing on every read.
--
-- Cart → order propagation: when the cart converts to an order
-- (existing checkout flow), the conversion code copies
-- cart_item_custom_fields rows into order_item_custom_fields and the
-- cart_items.modifier_total into the order_items total.
--
-- Same-variant duplicates: the existing uniq index on
-- (cart_id, variant_id) is left in place for v1 — adding the same
-- variant a second time still increments quantity, preserving the
-- FIRST set of field values. Allowing distinct lines per field set
-- requires a custom_fields_hash discriminator and is deferred.
-- =============================================================================

-- ─── 0. order_items.modifier_total ───────────────────────────────────
-- Mirror of the cart-side column. Each order_items row stores the
-- per-unit modifier contribution that was locked at checkout
-- conversion. Line total computed downstream as
-- (unit_price + modifier_total) * quantity.
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS modifier_total numeric(10, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_modifier_total_nonneg
    CHECK (modifier_total >= 0);

COMMENT ON COLUMN public.order_items.modifier_total IS
'Per-unit sum of custom-field modifiers locked at checkout (Phase 8g). Sum across order_item_custom_fields for this row equals modifier_total * quantity, with rounding.';

-- ─── 1. cart_items.modifier_total ────────────────────────────────────
-- Frozen sum of all custom-field modifiers contributed by this line,
-- in the cart's currency, per UNIT (multiplied by quantity at totals
-- computation time). Always >= 0 because we never negate base prices.
ALTER TABLE public.cart_items
  ADD COLUMN IF NOT EXISTS modifier_total numeric(10, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.cart_items
  ADD CONSTRAINT cart_items_modifier_total_nonneg
    CHECK (modifier_total >= 0);

COMMENT ON COLUMN public.cart_items.modifier_total IS
'Per-unit sum of custom-field modifier contributions (Phase 8g). Locked at add-to-cart time; survives field-config changes. Added to unit_price * quantity for the line subtotal.';

-- ─── 2. cart_item_custom_fields ──────────────────────────────────────
-- Per-line snapshot of customer-submitted custom-field values. Mirrors
-- order_item_custom_fields shape so the checkout conversion is a
-- direct table copy.
CREATE TABLE IF NOT EXISTS public.cart_item_custom_fields (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_item_id       uuid NOT NULL REFERENCES public.cart_items(id) ON DELETE CASCADE,
  field_id           uuid NOT NULL REFERENCES public.custom_fields(id) ON DELETE RESTRICT,
  -- For per_unit fields: 0..qty-1. NULL for per-line fields. (Phase 8i
  -- wires the per-unit collection UI; for Phase 8g this is always NULL.)
  unit_index         integer,
  value              jsonb NOT NULL,
  -- Locked-in modifier contribution for this single (field, unit) tuple.
  -- The sum across all rows for one cart_item must equal
  -- cart_items.modifier_total (within rounding).
  contributed_price  numeric(10, 2) NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CHECK (unit_index IS NULL OR unit_index >= 0),
  -- One row per (line, field, unit). Same uniqueness as
  -- order_item_custom_fields so the checkout copy is a 1:1 mapping.
  UNIQUE (cart_item_id, field_id, unit_index)
);
CREATE INDEX IF NOT EXISTS idx_cart_item_custom_fields_item
  ON public.cart_item_custom_fields(cart_item_id);
CREATE INDEX IF NOT EXISTS idx_cart_item_custom_fields_field
  ON public.cart_item_custom_fields(field_id);

COMMENT ON TABLE public.cart_item_custom_fields IS
'Per-cart-line snapshot of customer-submitted custom-field values + frozen modifier price (Phase 8g). Copied row-for-row into order_item_custom_fields at checkout conversion.';

-- ─── 3. RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.cart_item_custom_fields ENABLE ROW LEVEL SECURITY;

-- Cart owner can read their own custom field rows.
CREATE POLICY "cart_item_custom_fields_owner_select"
  ON public.cart_item_custom_fields FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.cart_items ci
    JOIN public.carts c ON c.id = ci.cart_id
    WHERE ci.id = cart_item_id
      AND c.user_id = auth.uid()
  ));

-- Cart owner can modify their own rows (insert/update/delete) via the
-- cart actions. Server actions running on behalf of the user pass the
-- standard supabase client (not service_role), so RLS applies.
CREATE POLICY "cart_item_custom_fields_owner_modify"
  ON public.cart_item_custom_fields FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.cart_items ci
    JOIN public.carts c ON c.id = ci.cart_id
    WHERE ci.id = cart_item_id
      AND c.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM public.cart_items ci
    JOIN public.carts c ON c.id = ci.cart_id
    WHERE ci.id = cart_item_id
      AND c.user_id = auth.uid()
  ));

-- Admins with manage:orders can read everyone's cart custom fields
-- (used by the admin order panel + support tooling later).
CREATE POLICY "cart_item_custom_fields_admin_select"
  ON public.cart_item_custom_fields FOR SELECT TO authenticated
  USING (public.has_permission('manage:orders'));
