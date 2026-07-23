-- =============================================================================
-- Promote `customers` to the primary business entity.
--
-- Before this migration, "customer" was implicit: an `auth.users` row +
-- `user_profiles` mirror for self-signed eshop customers, and a soup of
-- `guest_*` columns on each individual `orders` row for everyone else.
-- That model couldn't:
--   * give offline customers (phone / in-store) a reusable address book
--     without polluting auth.users with stub accounts (and MAU counts)
--   * keep continuity across multiple phone orders from the same person
--   * survive a customer correcting a misspelled name without rewriting
--     historical order documents
--
-- This migration introduces a `customers` table that every order links to.
-- Some `customers` rows have an `auth_user_id` (they can log in); the rest are
-- admin-curated or marketplace-imported. Email and phone are contact info
-- (not identity), with no UNIQUE constraints — multiple rows may legitimately
-- share contact details (families sharing an email, recycled phone numbers).
-- Dedup happens at the application layer with a strict (email AND phone) match
-- prompt; the DB just stores normalized lookup columns so the prompt query is
-- cheap and consistent.
--
-- Snapshot strategy: `orders.guest_{name,email,phone}` are renamed to
-- `customer_{name,email,phone}_at_order` and become explicit historical
-- snapshots populated on every insert — matching how the supply-order side
-- already snapshots (variant_label, business_sku_at_draft, etc.) and how
-- shipping_address / billing_address jsonb already work. Correcting a
-- customer's saved name never rewrites prior invoices.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enum: customer_source. Mirrors but is distinct from order_source — a
-- self-signed customer (source='eshop_signup') can place a phone-source order
-- when the admin takes over their call, and vice versa.
-- -----------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'customer_source') THEN
    CREATE TYPE public.customer_source AS ENUM (
      'eshop_signup',
      'admin_manual',
      'phone',
      'in_store'
    );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- customers table
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.customers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable + UNIQUE: at most one customers row per auth user. NULL means
  -- offline-only (admin-curated). When the customer later signs up via the
  -- eshop, we link by setting this column.
  auth_user_id         uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Contact info — NOT identity. No UNIQUE constraints.
  email                text,
  phone                text,
  first_name           text,
  last_name            text,

  -- Stored normalized lookup columns. Generated on insert/update — no app code
  -- can forget to normalize. Matched against the same normalization on the
  -- application side at order entry to trigger the "Είστε εσείς?" prompt.
  email_normalized     text GENERATED ALWAYS AS (NULLIF(lower(trim(email)), '')) STORED,
  phone_normalized     text GENERATED ALWAYS AS (NULLIF(regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g'), '')) STORED,

  -- Preferences mirror user_profiles for self-signed customers.
  preferred_locale     text NOT NULL DEFAULT 'el',
  preferred_currency   text NOT NULL DEFAULT 'EUR',
  marketing_opt_in     boolean NOT NULL DEFAULT false,

  source               public.customer_source NOT NULL DEFAULT 'eshop_signup',
  notes                text,
  -- Admin who manually created an offline customer record. NULL for self-signups.
  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- A customers row must be reachable some way — at least one of an auth
  -- account, an email, or a phone. Prevents totally-empty ghost rows.
  CONSTRAINT customers_contactable CHECK (
    auth_user_id IS NOT NULL
    OR email IS NOT NULL
    OR phone IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_customers_email_normalized
  ON public.customers(email_normalized)
  WHERE email_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_phone_normalized
  ON public.customers(phone_normalized)
  WHERE phone_normalized IS NOT NULL;
-- Composite for the "match on email AND phone" lookup we do on every order
-- entry. Partial: only useful when both fields are present.
CREATE INDEX IF NOT EXISTS idx_customers_email_phone_match
  ON public.customers(email_normalized, phone_normalized)
  WHERE email_normalized IS NOT NULL AND phone_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_created_at
  ON public.customers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_source
  ON public.customers(source);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- Customer can read their own row.
CREATE POLICY "customers_select_self"
  ON public.customers FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() OR public.has_permission('manage:orders'));

-- Customer can update their own row.
CREATE POLICY "customers_update_self"
  ON public.customers FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- Admin full access.
CREATE POLICY "customers_admin_write"
  ON public.customers FOR ALL TO authenticated
  USING (public.has_permission('manage:orders'))
  WITH CHECK (public.has_permission('manage:orders'));

-- -----------------------------------------------------------------------------
-- Backfill from existing user_profiles. One customers row per profile, linked
-- by auth_user_id. Idempotent via ON CONFLICT.
-- -----------------------------------------------------------------------------

INSERT INTO public.customers
  (auth_user_id, email, phone, first_name, last_name,
   preferred_locale, preferred_currency, marketing_opt_in,
   source, created_at, updated_at)
SELECT
  up.id,
  up.email,
  up.phone,
  up.first_name,
  up.last_name,
  up.preferred_locale,
  up.preferred_currency,
  up.marketing_opt_in,
  'eshop_signup'::public.customer_source,
  up.created_at,
  up.updated_at
FROM public.user_profiles up
ON CONFLICT (auth_user_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Auto-sync user_profiles -> customers. Going forward, any insert or update on
-- user_profiles should keep the linked customers row coherent. We don't go
-- the other direction (customers -> user_profiles): admin-edited customer
-- fields shouldn't silently overwrite the user's own profile.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_customer_from_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.customers
    (auth_user_id, email, phone, first_name, last_name,
     preferred_locale, preferred_currency, marketing_opt_in, source)
  VALUES
    (NEW.id, NEW.email, NEW.phone, NEW.first_name, NEW.last_name,
     NEW.preferred_locale, NEW.preferred_currency, NEW.marketing_opt_in,
     'eshop_signup')
  ON CONFLICT (auth_user_id) DO UPDATE SET
    email              = EXCLUDED.email,
    phone              = EXCLUDED.phone,
    first_name         = EXCLUDED.first_name,
    last_name          = EXCLUDED.last_name,
    preferred_locale   = EXCLUDED.preferred_locale,
    preferred_currency = EXCLUDED.preferred_currency,
    marketing_opt_in   = EXCLUDED.marketing_opt_in,
    updated_at         = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_customer_from_profile_ins ON public.user_profiles;
CREATE TRIGGER trg_sync_customer_from_profile_ins
  AFTER INSERT ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_customer_from_profile();

DROP TRIGGER IF EXISTS trg_sync_customer_from_profile_upd ON public.user_profiles;
CREATE TRIGGER trg_sync_customer_from_profile_upd
  AFTER UPDATE OF email, phone, first_name, last_name,
                 preferred_locale, preferred_currency, marketing_opt_in
  ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_customer_from_profile();

-- =============================================================================
-- orders: add customer_id + snapshot columns, backfill, drop old columns
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_id              uuid REFERENCES public.customers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS customer_name_at_order   text,
  ADD COLUMN IF NOT EXISTS customer_email_at_order  text,
  ADD COLUMN IF NOT EXISTS customer_phone_at_order  text;

-- Backfill A: orders attached to an auth user — link via customers.auth_user_id.
UPDATE public.orders o
SET customer_id = c.id
FROM public.customers c
WHERE c.auth_user_id = o.user_id
  AND o.customer_id IS NULL
  AND o.user_id IS NOT NULL;

-- Backfill B: guest orders — create one customers row per distinct guest tuple,
-- then point each matching order at it. Done in a single transactional pass.
WITH unmapped AS (
  SELECT DISTINCT
    guest_email,
    guest_phone,
    guest_name
  FROM public.orders
  WHERE customer_id IS NULL
    AND (guest_email IS NOT NULL OR guest_phone IS NOT NULL)
),
created AS (
  INSERT INTO public.customers
    (email, phone, first_name, last_name, source)
  SELECT
    u.guest_email,
    u.guest_phone,
    -- Best-effort split: "First Last" -> ("First","Last"); single word -> first_name only.
    NULLIF(split_part(coalesce(u.guest_name, ''), ' ', 1), ''),
    NULLIF(NULLIF(substring(coalesce(u.guest_name, '') FROM position(' ' in coalesce(u.guest_name, ' ')) + 1), ''), coalesce(u.guest_name, '')),
    'admin_manual'::public.customer_source
  FROM unmapped u
  RETURNING id, email, phone, first_name
)
UPDATE public.orders o
SET customer_id = c.id
FROM created c
WHERE o.customer_id IS NULL
  AND coalesce(o.guest_email, '') = coalesce(c.email, '')
  AND coalesce(o.guest_phone, '') = coalesce(c.phone, '');

-- Snapshot backfill: use guest_* when present (those WERE the at-order values),
-- otherwise fall back to the linked customer's current values.
UPDATE public.orders o
SET
  customer_name_at_order = COALESCE(
    o.guest_name,
    NULLIF(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '')
  ),
  customer_email_at_order = COALESCE(o.guest_email, c.email),
  customer_phone_at_order = COALESCE(o.guest_phone, c.phone)
FROM public.customers c
WHERE c.id = o.customer_id
  AND (o.customer_name_at_order IS NULL
       OR o.customer_email_at_order IS NULL
       OR o.customer_phone_at_order IS NULL);

-- Enforce: every order MUST have a customer.
ALTER TABLE public.orders
  ALTER COLUMN customer_id SET NOT NULL;

-- Drop old user-or-guest support — `customer_id` is the new identity, and
-- snapshot columns hold the historical contact info.
--
-- IMPORTANT: Postgres refuses to drop a column while policies on ANY table
-- depend on it. We drop every policy that references `orders.user_id` before
-- the ALTER, then recreate them below to traverse the new customers chain.
-- The dependents extend beyond `orders` itself: courier_integration's
-- shipments + shipment_events policies also join through orders.user_id.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_user_or_guest_check;

DROP POLICY IF EXISTS "orders_select_own_or_admin"          ON public.orders;
DROP POLICY IF EXISTS "order_items_select_own_or_admin"     ON public.order_items;
DROP POLICY IF EXISTS "shipments_select_own_or_admin"       ON public.shipments;
DROP POLICY IF EXISTS "shipment_events_select_own_or_admin" ON public.shipment_events;

ALTER TABLE public.orders
  DROP COLUMN IF EXISTS user_id,
  DROP COLUMN IF EXISTS guest_name,
  DROP COLUMN IF EXISTS guest_email,
  DROP COLUMN IF EXISTS guest_phone;

DROP INDEX IF EXISTS public.idx_orders_user_id;
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON public.orders(customer_id);

-- Recreate the policies, now routing customer identity through `customers`.

CREATE POLICY "orders_select_own_or_admin"
  ON public.orders FOR SELECT TO authenticated
  USING (
    customer_id IN (SELECT id FROM public.customers WHERE auth_user_id = auth.uid())
    OR public.has_permission('manage:orders')
  );

CREATE POLICY "order_items_select_own_or_admin"
  ON public.order_items FOR SELECT TO authenticated
  USING (
    order_id IN (
      SELECT o.id
      FROM public.orders o
      JOIN public.customers c ON c.id = o.customer_id
      WHERE c.auth_user_id = auth.uid()
    )
    OR public.has_permission('manage:orders')
  );

CREATE POLICY "shipments_select_own_or_admin"
  ON public.shipments FOR SELECT TO authenticated
  USING (
    order_id IN (
      SELECT o.id
      FROM public.orders o
      JOIN public.customers c ON c.id = o.customer_id
      WHERE c.auth_user_id = auth.uid()
    )
    OR public.has_permission('manage:shipments')
  );

CREATE POLICY "shipment_events_select_own_or_admin"
  ON public.shipment_events FOR SELECT TO authenticated
  USING (
    shipment_id IN (
      SELECT s.id
      FROM public.shipments s
      JOIN public.orders o    ON o.id = s.order_id
      JOIN public.customers c ON c.id = o.customer_id
      WHERE c.auth_user_id = auth.uid()
    )
    OR public.has_permission('manage:shipments')
  );

-- =============================================================================
-- addresses: migrate user_id -> customer_id
-- =============================================================================

ALTER TABLE public.addresses
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE;

UPDATE public.addresses a
SET customer_id = c.id
FROM public.customers c
WHERE c.auth_user_id = a.user_id
  AND a.customer_id IS NULL;

-- Remove any addresses that point at an auth_user_id with no matching customer.
-- Should be impossible given the backfill, but guard against orphaned rows that
-- would block the NOT NULL constraint below.
DELETE FROM public.addresses WHERE customer_id IS NULL;

ALTER TABLE public.addresses ALTER COLUMN customer_id SET NOT NULL;

-- Move the unique indexes from user_id to customer_id.
DROP INDEX IF EXISTS public.idx_addresses_default_billing;
DROP INDEX IF EXISTS public.idx_addresses_default_shipping;
DROP INDEX IF EXISTS public.idx_addresses_user_id;

CREATE INDEX IF NOT EXISTS idx_addresses_customer_id
  ON public.addresses(customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_addresses_default_billing
  ON public.addresses(customer_id) WHERE is_default_billing = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_addresses_default_shipping
  ON public.addresses(customer_id) WHERE is_default_shipping = true;

-- Drop the existing per-user_id policies BEFORE the column drop; otherwise
-- Postgres refuses the drop (same dependency pattern as the orders block
-- above). Recreated below against customer_id.
DROP POLICY IF EXISTS "addresses_select_own"  ON public.addresses;
DROP POLICY IF EXISTS "addresses_insert_own"  ON public.addresses;
DROP POLICY IF EXISTS "addresses_update_own"  ON public.addresses;
DROP POLICY IF EXISTS "addresses_delete_own"  ON public.addresses;

ALTER TABLE public.addresses DROP COLUMN IF EXISTS user_id;

CREATE POLICY "addresses_self_or_admin_select"
  ON public.addresses FOR SELECT TO authenticated
  USING (
    customer_id IN (SELECT id FROM public.customers WHERE auth_user_id = auth.uid())
    OR public.has_permission('manage:orders')
  );

CREATE POLICY "addresses_self_or_admin_insert"
  ON public.addresses FOR INSERT TO authenticated
  WITH CHECK (
    customer_id IN (SELECT id FROM public.customers WHERE auth_user_id = auth.uid())
    OR public.has_permission('manage:orders')
  );

CREATE POLICY "addresses_self_or_admin_update"
  ON public.addresses FOR UPDATE TO authenticated
  USING (
    customer_id IN (SELECT id FROM public.customers WHERE auth_user_id = auth.uid())
    OR public.has_permission('manage:orders')
  )
  WITH CHECK (
    customer_id IN (SELECT id FROM public.customers WHERE auth_user_id = auth.uid())
    OR public.has_permission('manage:orders')
  );

CREATE POLICY "addresses_self_or_admin_delete"
  ON public.addresses FOR DELETE TO authenticated
  USING (
    customer_id IN (SELECT id FROM public.customers WHERE auth_user_id = auth.uid())
    OR public.has_permission('manage:orders')
  );

-- -----------------------------------------------------------------------------
-- Rewrite the `ensure_single_default_address` trigger function to scope by
-- customer_id instead of the dropped user_id column. The function would
-- otherwise compile-fine (plpgsql is lazily validated) but blow up on the
-- next address insert/update with `column "user_id" does not exist`.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_single_default_address()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_default_billing = true THEN
    UPDATE public.addresses
       SET is_default_billing = false
     WHERE customer_id = NEW.customer_id
       AND id <> NEW.id
       AND is_default_billing = true;
  END IF;

  IF NEW.is_default_shipping = true THEN
    UPDATE public.addresses
       SET is_default_shipping = false
     WHERE customer_id = NEW.customer_id
       AND id <> NEW.id
       AND is_default_shipping = true;
  END IF;

  IF NEW.is_default = true THEN
    UPDATE public.addresses
       SET is_default = false
     WHERE customer_id = NEW.customer_id
       AND id <> NEW.id
       AND is_default = true;
  END IF;

  RETURN NEW;
END;
$$;
