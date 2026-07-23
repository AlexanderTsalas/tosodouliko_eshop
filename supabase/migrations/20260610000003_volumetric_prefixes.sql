-- =============================================================================
-- Volumetric prefixes — named size classes for locker/parcel pricing.
--
-- Background: locker couriers (BoxNow, Speedex APM, etc.) charge by size
-- TIER, not exact dimensions. BoxNow accepts a parcel_size code (1/2/3),
-- ACS has its own size codes, etc. A single product fits one tier
-- regardless of which carrier ships it — so we model the tier once and
-- map it to per-carrier codes via a jsonb field.
--
-- Two-source data model (deliberate — see design discussion):
--   - This table holds the CATEGORICAL tier (which size class the
--     product belongs to). Carriers that need a size code read this.
--   - products.length_mm / width_mm / height_mm hold the ACTUAL
--     dimensions. Carriers that compute volumetric weight from raw
--     dimensions (most postal services) read those.
--
-- A product can have both, one, or neither:
--   - Prefix only: standardized packaging that fits a known tier
--   - Raw dims only: custom packaging, no standard tier matches
--   - Both: tier + precise dims (most explicit, most flexibility)
--   - Neither: small/intangible items where shipping isn't size-priced
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.volumetric_prefixes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE,
  display_name     text NOT NULL,
  description      text,
  /* Reference outer dimensions for this tier — mm. NULL = unconstrained
     in that dimension (rare but valid for irregular shapes). */
  max_length_mm    integer,
  max_width_mm     integer,
  max_height_mm    integer,
  /* Max gross weight in grams. NULL = no weight cap. */
  max_weight_g     integer,
  /* Per-carrier size code mapping. Example:
        { "box_now": 1, "acs": "STD", "speedex_apm": "A" }
     Carrier provider classes pluck the key they care about. Free-form
     so new carriers can be added without a schema migration. */
  carrier_codes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  display_order    integer NOT NULL DEFAULT 100,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.volumetric_prefixes IS
  'Named parcel size tiers — used by locker/APM couriers that price by size class. Per-carrier codes live in carrier_codes jsonb so new carriers slot in without schema changes.';

COMMENT ON COLUMN public.volumetric_prefixes.carrier_codes IS
  'Mapping from internal carrier_slug → size code/identifier this carrier expects. Example: {"box_now": 1, "acs": "STD"}.';

-- Defensive: max dimensions and weight must be positive when set.
ALTER TABLE public.volumetric_prefixes
  DROP CONSTRAINT IF EXISTS volumetric_prefixes_positive;
ALTER TABLE public.volumetric_prefixes
  ADD CONSTRAINT volumetric_prefixes_positive
  CHECK (
    (max_length_mm IS NULL OR max_length_mm > 0) AND
    (max_width_mm IS NULL OR max_width_mm > 0) AND
    (max_height_mm IS NULL OR max_height_mm > 0) AND
    (max_weight_g IS NULL OR max_weight_g > 0)
  );

CREATE INDEX IF NOT EXISTS idx_volumetric_prefixes_active
  ON public.volumetric_prefixes(display_order, display_name)
  WHERE active;

-- ---------------------------------------------------------------------------
-- Wire products → prefix. Nullable FK; SET NULL on delete so removing a
-- prefix doesn't cascade-delete products. RLS lives on products already.
-- ---------------------------------------------------------------------------

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS volumetric_prefix_id uuid
    REFERENCES public.volumetric_prefixes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_volumetric_prefix
  ON public.products(volumetric_prefix_id)
  WHERE volumetric_prefix_id IS NOT NULL;

COMMENT ON COLUMN public.products.volumetric_prefix_id IS
  'Optional size-tier assignment. When set, locker couriers use the matching code from volumetric_prefixes.carrier_codes. Raw length/width/height/weight columns are still authoritative for volumetric pricing.';

-- ---------------------------------------------------------------------------
-- Seed: BoxNow's three official locker sizes. Values straight from
-- BoxNow's API docs (carrier_codes.box_now = 1/2/3 matches their
-- parcel_size enum). Admins can edit / extend from the UI.
-- ---------------------------------------------------------------------------

INSERT INTO public.volumetric_prefixes
  (slug, display_name, description, max_length_mm, max_width_mm, max_height_mm, max_weight_g, carrier_codes, display_order)
VALUES
  (
    'small',
    'Small',
    'Μικρό πακέτο — χωράει σε locker μικρής διαμέρισης. Ιδανικό για αξεσουάρ, μικρά παιχνίδια.',
    450, 350, 180, 2000,
    '{"box_now": 1}'::jsonb,
    10
  ),
  (
    'medium',
    'Medium',
    'Μεσαίο πακέτο — μέγεθος που καλύπτει τα περισσότερα ρούχα και μεσαία προϊόντα.',
    450, 350, 360, 5000,
    '{"box_now": 2}'::jsonb,
    20
  ),
  (
    'large',
    'Large',
    'Μεγάλο πακέτο — locker της μεγαλύτερης διαμέρισης. Ογκώδη ρούχα ή πολλαπλά τεμάχια.',
    450, 350, 680, 10000,
    '{"box_now": 3}'::jsonb,
    30
  )
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RLS: read-anyone (these are public-ish reference data — useful at
-- checkout to label which size each product is). Write requires
-- manage:couriers (same permission that gates the rest of the
-- carrier/courier admin surface).
-- ---------------------------------------------------------------------------

ALTER TABLE public.volumetric_prefixes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "volumetric_prefixes_read" ON public.volumetric_prefixes;
CREATE POLICY "volumetric_prefixes_read"
  ON public.volumetric_prefixes FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "volumetric_prefixes_write" ON public.volumetric_prefixes;
CREATE POLICY "volumetric_prefixes_write"
  ON public.volumetric_prefixes FOR ALL
  TO authenticated
  USING (public.has_permission('manage:couriers'))
  WITH CHECK (public.has_permission('manage:couriers'));

-- ---------------------------------------------------------------------------
-- updated_at is maintained by the application layer (every action that
-- writes to this table also sets updated_at = now()). No trigger needed
-- since this table follows the same pattern as suppliers / vat_rates /
-- delivery_carriers (none of which use a trigger either).
-- ---------------------------------------------------------------------------
