-- =============================================================================
-- Phase 0 of courier-integration-design.md — Carrier model as data
--
-- delivery_carriers is the operational set of carriers the system knows about.
-- Built-in carriers (acs, elta, box_now, speedex, geniki, other) ship as
-- is_custom=false seeded rows; admins toggle is_active to control checkout
-- visibility. Admins can also create new "custom" carriers with is_custom=true
-- for non-integrated workflows (e.g., "Παράδοση δικιά μας").
--
-- The static CARRIERS enum in src/config/storefront.ts becomes a fallback /
-- legacy alias during the migration; new code reads from this table.
--
-- Two key axes are independent:
--   * is_active        → carrier appears at checkout (admin-controlled visibility)
--   * (provider class) → carrier has an API integration (gated by
--                        carrier_provider_configs row + provider class in code)
--
-- A carrier can be visible at checkout without an API integration (manual
-- workflow). An integrated carrier can be hidden without losing credentials.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.delivery_carriers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable identifier referenced by orders.carrier_slug and
  -- carrier_provider_configs.carrier. For built-ins this matches the
  -- CarrierValue enum slugs ('acs', etc.); for custom carriers, admin-input
  -- normalized to a URL-safe form ('custom_van_xyz').
  slug            text UNIQUE NOT NULL,
  -- Greek customer-facing display name.
  display_name    text NOT NULL,
  -- Which delivery methods this carrier can fulfil. For built-ins, the seed
  -- value is the upper bound the provider class structurally supports; admin
  -- may narrow but not widen. Custom carriers are fully admin-defined.
  supported_delivery_methods text[] NOT NULL CHECK (
    array_length(supported_delivery_methods, 1) > 0
    AND supported_delivery_methods <@ ARRAY[
      'home_delivery',
      'store_pickup',
      'delivery_station_pickup',
      'carrier_pickup'
    ]::text[]
  ),
  -- Visibility at checkout. Independent of integration depth.
  is_active       boolean NOT NULL DEFAULT false,
  -- true = admin-created (no provider class exists in code).
  -- false = built-in (may or may not have an active carrier_provider_configs row).
  is_custom       boolean NOT NULL DEFAULT false,
  display_order   int NOT NULL DEFAULT 0,
  -- Template for the "Track on {carrier}" button. {voucher} is substituted
  -- with orders.tracking_number at render time. Null = no external button.
  tracking_url_template text,
  -- For custom carriers: which status timeline this carrier follows. Null
  -- means "use generic/default timeline". Built-in carriers ignore this
  -- field — their timeline is hardcoded in src/config/status-timelines.ts.
  timeline_preset text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_carriers_active_order
  ON public.delivery_carriers(is_active, display_order)
  WHERE is_active = true;

ALTER TABLE public.delivery_carriers ENABLE ROW LEVEL SECURITY;

-- Public read of *active* carriers — checkout needs to list them anonymously.
-- Inactive rows are admin-only so customers don't see disabled options.
CREATE POLICY "delivery_carriers_public_read_active"
  ON public.delivery_carriers FOR SELECT TO anon, authenticated
  USING (is_active = true);

-- Admin read of all rows (including inactive) for the management page.
CREATE POLICY "delivery_carriers_admin_select_all"
  ON public.delivery_carriers FOR SELECT TO authenticated
  USING (public.has_permission('manage:couriers'));

-- Admin-only mutations.
CREATE POLICY "delivery_carriers_admin_write"
  ON public.delivery_carriers FOR ALL TO authenticated
  USING (public.has_permission('manage:couriers'))
  WITH CHECK (public.has_permission('manage:couriers'));

COMMENT ON TABLE  public.delivery_carriers IS
  'Admin-managed list of delivery carriers. Built-in rows have is_custom=false and a provider class in code; admin-created rows have is_custom=true and no provider class. Visibility at checkout is controlled by is_active independently of API integration depth.';
COMMENT ON COLUMN public.delivery_carriers.slug IS
  'Stable identifier referenced by orders.carrier_slug and carrier_provider_configs.carrier. URL-safe lowercase.';
COMMENT ON COLUMN public.delivery_carriers.supported_delivery_methods IS
  'Subset of delivery_method enum values this carrier can fulfil. For built-ins, the seed value is the provider''s upper bound; admin can narrow.';
COMMENT ON COLUMN public.delivery_carriers.is_custom IS
  'true = admin-created (no provider class). false = built-in (may have provider class + API integration).';
COMMENT ON COLUMN public.delivery_carriers.tracking_url_template IS
  'External tracking URL template with {voucher} placeholder. Substituted with orders.tracking_number at render time. Null = no external button shown.';

-- ---------------------------------------------------------------------------
-- Seed built-in carriers
--
-- These match the CARRIERS enum in src/config/storefront.ts and the
-- DELIVERY_BY_CARRIER matrix in src/config/checkout-compatibility.ts.
--
-- is_active=true on all built-ins so the checkout's behavior matches the
-- pre-migration state (all 6 carriers visible). Once the admin Couriers
-- page surfaces a per-row toggle, merchants can selectively deactivate
-- carriers they don't offer.
-- ---------------------------------------------------------------------------

INSERT INTO public.delivery_carriers
  (slug, display_name, supported_delivery_methods, is_active, is_custom, display_order, tracking_url_template)
VALUES
  ('acs',     'ACS',                  ARRAY['home_delivery','delivery_station_pickup','carrier_pickup'], true, false, 10, 'https://www.acscourier.net/en/tracking?p_no={voucher}'),
  ('elta',    'ΕΛΤΑ',                 ARRAY['home_delivery','delivery_station_pickup','carrier_pickup'], true, false, 20, NULL),
  ('box_now', 'Box Now',              ARRAY['delivery_station_pickup'],                                  true, false, 30, NULL),
  ('speedex', 'Speedex',              ARRAY['home_delivery','carrier_pickup'],                           true, false, 40, NULL),
  ('geniki',  'Γενική Ταχυδρομική',   ARRAY['home_delivery','delivery_station_pickup','carrier_pickup'], true, false, 50, 'https://www.taxydromiki.com/track/{voucher}'),
  ('other',   'Άλλο',                 ARRAY['home_delivery','delivery_station_pickup','carrier_pickup'], true, false, 60, NULL)
ON CONFLICT (slug) DO NOTHING;
