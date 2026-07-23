-- =============================================================================
-- Custom delivery methods — admin-defined relabel + scoping layer on top of
-- the 4 hardcoded base methods.
--
-- Use case: merchant wants to surface "Παράδοση με δικό μας Van" at checkout,
-- which conceptually IS a home delivery but they want it presented under
-- their own brand and (optionally) tied to a specific carrier (e.g. their
-- own custom carrier row).
--
-- Design choice — relabel layer, not a new method axis:
--   - DeliveryMethodValue stays a 4-element literal union (home_delivery /
--     store_pickup / delivery_station_pickup / carrier_pickup).
--   - Every custom method declares a `base_method` so all existing
--     compatibility logic (carrier × method, payment × method, pickup
--     requirements) keeps working without change.
--   - orders.delivery_method continues to hold the base value; a new
--     orders.custom_delivery_method_slug column remembers which custom
--     method was picked for receipt / label rendering.
--
-- Carrier scoping is OPTIONAL:
--   - carrier_slug=NULL → method works with ANY carrier whose own
--     supported_delivery_methods includes the base_method.
--   - carrier_slug='custom_...' → method ONLY shows when that carrier is
--     chosen; lets "Δικιά μας Van" attach a custom carrier so the customer
--     can't pick BoxNow for it.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.custom_delivery_methods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable slug used by orders.custom_delivery_method_slug. Admin-input
  -- normalized to a URL-safe form ('custom_van_delivery'). Prefix enforced
  -- so a custom slug never collides with a future built-in name.
  slug            text UNIQUE NOT NULL CHECK (slug ~ '^custom_[a-z0-9_]+$'),
  -- Customer-facing label shown at checkout.
  display_name    text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  -- Optional helper text — appears under the radio at checkout, e.g.
  -- "Παράδοση εντός Αθηνών μέσω δικού μας van. Παράδοση εντός 24 ωρών."
  description     text,
  -- Which of the 4 base methods this custom one maps to for compatibility
  -- purposes. Drives: does the customer need an address, does pickup
  -- selection apply, which payment methods are valid by default, etc.
  base_method     text NOT NULL CHECK (base_method IN (
    'home_delivery',
    'store_pickup',
    'delivery_station_pickup',
    'carrier_pickup'
  )),
  -- Optional carrier scope. NULL = any carrier supporting base_method.
  -- ON DELETE SET NULL so deleting the carrier widens the method's
  -- availability rather than orphaning the row.
  carrier_slug    text REFERENCES public.delivery_carriers(slug) ON DELETE SET NULL,
  -- Visibility at checkout. Independent of the carrier's is_active.
  is_active       boolean NOT NULL DEFAULT false,
  -- Sort order in the delivery-method radio group. Custom methods appear
  -- after built-ins by default (display_order >= 100).
  display_order   integer NOT NULL DEFAULT 100,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_delivery_methods_active_order
  ON public.custom_delivery_methods(is_active, display_order)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_custom_delivery_methods_carrier
  ON public.custom_delivery_methods(carrier_slug)
  WHERE carrier_slug IS NOT NULL;

ALTER TABLE public.custom_delivery_methods ENABLE ROW LEVEL SECURITY;

-- Public read of active rows — checkout lists them for the customer
-- without auth, same pattern as delivery_carriers.
CREATE POLICY "custom_delivery_methods_public_read_active"
  ON public.custom_delivery_methods FOR SELECT TO anon, authenticated
  USING (is_active = true);

-- Admin read of all rows for the management page.
CREATE POLICY "custom_delivery_methods_admin_select_all"
  ON public.custom_delivery_methods FOR SELECT TO authenticated
  USING (public.has_permission('manage:couriers'));

-- Admin-only writes.
CREATE POLICY "custom_delivery_methods_admin_write"
  ON public.custom_delivery_methods FOR ALL TO authenticated
  USING (public.has_permission('manage:couriers'))
  WITH CHECK (public.has_permission('manage:couriers'));

COMMENT ON TABLE  public.custom_delivery_methods IS
  'Admin-defined relabel layer on top of the 4 base delivery methods. Each row picks a base_method for compatibility purposes and an optional carrier_slug for scoping. orders.custom_delivery_method_slug references this table.';
COMMENT ON COLUMN public.custom_delivery_methods.base_method IS
  'Which built-in base method this custom one maps to. Drives address requirements, pickup selection, baseline payment compatibility.';
COMMENT ON COLUMN public.custom_delivery_methods.carrier_slug IS
  'Optional carrier scope. NULL = available with any carrier supporting base_method. Specific slug = this custom method only shows when that carrier is chosen.';

-- ---------------------------------------------------------------------------
-- orders.custom_delivery_method_slug
--
-- Remembers which custom method was selected at checkout for label / receipt
-- rendering. The order's delivery_method column continues to hold the base
-- value, so all existing fulfillment + reporting code that filters on
-- delivery_method keeps working. Nullable for orders placed before this
-- column existed and for orders using a built-in method.
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS custom_delivery_method_slug text;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_custom_delivery_method_fkey;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_custom_delivery_method_fkey
  FOREIGN KEY (custom_delivery_method_slug)
  REFERENCES public.custom_delivery_methods(slug) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_custom_delivery_method
  ON public.orders(custom_delivery_method_slug)
  WHERE custom_delivery_method_slug IS NOT NULL;

COMMENT ON COLUMN public.orders.custom_delivery_method_slug IS
  'Optional reference to custom_delivery_methods. When set, the order was placed via a custom relabel layer; receipts / labels should use the custom display_name. delivery_method still holds the base method for fulfillment logic.';
