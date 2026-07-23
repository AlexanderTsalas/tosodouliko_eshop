-- =============================================================================
-- Phase 10 — unified courier directory caches.
--
-- Previously: per-carrier tables (acs_station_cache, acs_postcode_cache). With
-- BoxNow + Geniki integrations next, that pattern grows N tables per cache. We
-- consolidate into two carrier-discriminated tables with a `carrier` column +
-- a JSONB `raw` for the carrier-specific fields each carrier brings.
--
-- Old tables (acs_station_cache, acs_postcode_cache) are LEFT IN PLACE — this
-- migration backfills the unified tables from them. Code is switched to read
-- and write only the unified tables in the same release; a future migration
-- drops the legacy tables once we're confident.
--
-- Shape choices:
--   - `kind` is text (semantic), not int. ACS's 1/2/4/5/7 are mapped to
--     'central_store' / 'branch' / 'xpress' / 'kiosk' / 'smartpoint'. BoxNow
--     would use 'locker'; Geniki 'shop' / 'locker'. Queryable across carriers.
--   - PK includes `sub_location_id` to preserve ACS station+branch composite
--     keys. Carriers without branches store ''.
--   - `raw` JSONB preserves the full carrier-specific record so adding a new
--     consumer column doesn't need a migration — just a JSON path read.
--
-- TTL stays at 30 days, enforced application-side via `cached_at`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- couriers_location_cache
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.couriers_location_cache (
  -- FK to delivery_carriers so deletion of a custom carrier surfaces the
  -- dependency before silently orphaning cache rows. Built-ins are seeded
  -- and never deleted via the table API.
  carrier            text NOT NULL REFERENCES public.delivery_carriers(slug) ON DELETE RESTRICT,
  country            text NOT NULL,
  -- Semantic location kind: 'central_store', 'smartpoint', 'locker', 'shop', etc.
  -- Each carrier picks its own vocabulary; the only contract is that the same
  -- kind+location_id pair is stable across refreshes.
  kind               text NOT NULL,
  -- Carrier-opaque location identifier. ACS: station_id (e.g. 'ΑΘ'). BoxNow:
  -- locker UUID. Geniki: shop code.
  location_id        text NOT NULL,
  -- For ACS, branch_id (1..N). For carriers without sub-IDs, '' is the
  -- canonical empty. Kept as text so the PK doesn't have to deal with NULLs.
  sub_location_id    text NOT NULL DEFAULT '',
  -- Display fields shared across carriers. Each is nullable since not every
  -- carrier exposes every field.
  name               text,
  address            text,
  zipcode            text,
  area_label         text,
  lat                numeric(10, 7),
  lng                numeric(10, 7),
  phones             text,
  working_hours      text,
  -- Full carrier-specific record (e.g. ACS's truck_pickup_hours, services,
  -- working_hours_sat, station_id_en). Keeps the rest of the row stable
  -- while letting future consumers reach in.
  raw                jsonb,
  cached_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (carrier, country, kind, location_id, sub_location_id)
);

CREATE INDEX IF NOT EXISTS idx_couriers_location_cache_country
  ON public.couriers_location_cache(carrier, country);
CREATE INDEX IF NOT EXISTS idx_couriers_location_cache_zipcode
  ON public.couriers_location_cache(carrier, country, zipcode);

ALTER TABLE public.couriers_location_cache ENABLE ROW LEVEL SECURITY;

-- Same read-everyone / write-admin shape as the legacy ACS tables. The
-- customer checkout reads this to populate pickup-station selects.
CREATE POLICY "couriers_location_cache_public_read"
  ON public.couriers_location_cache FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "couriers_location_cache_admin_write"
  ON public.couriers_location_cache FOR ALL TO authenticated
  USING (public.has_permission('manage:couriers'))
  WITH CHECK (public.has_permission('manage:couriers'));

-- ---------------------------------------------------------------------------
-- couriers_postcode_cache
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.couriers_postcode_cache (
  carrier            text NOT NULL REFERENCES public.delivery_carriers(slug) ON DELETE RESTRICT,
  country            text NOT NULL,
  zipcode            text NOT NULL,
  -- Resolved primary location (ACS: Station_ID, e.g. 'ΑΘ'). Null when the
  -- carrier doesn't recognize the postcode — negative result is cached too
  -- so a bad zipcode doesn't thrash the API on every retry.
  station_id         text,
  -- ACS Branch_ID stored as text for symmetry with sub_location_id elsewhere.
  -- Null for carriers without per-postcode branch resolution.
  sub_station_id     text,
  is_inaccessible    boolean NOT NULL DEFAULT false,
  area_label         text,
  raw                jsonb,
  cached_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (carrier, country, zipcode)
);

CREATE INDEX IF NOT EXISTS idx_couriers_postcode_cache_station
  ON public.couriers_postcode_cache(carrier, country, station_id);

ALTER TABLE public.couriers_postcode_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "couriers_postcode_cache_public_read"
  ON public.couriers_postcode_cache FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "couriers_postcode_cache_admin_write"
  ON public.couriers_postcode_cache FOR ALL TO authenticated
  USING (public.has_permission('manage:couriers'))
  WITH CHECK (public.has_permission('manage:couriers'));

-- ---------------------------------------------------------------------------
-- Backfill from legacy ACS tables.
--
-- Idempotent: ON CONFLICT DO NOTHING so re-running the migration is safe.
-- The legacy tables are LEFT INTACT — this is read-only from the legacy
-- side. Code switches reads/writes to the new tables in the same release.
-- ---------------------------------------------------------------------------

INSERT INTO public.couriers_location_cache (
  carrier, country, kind, location_id, sub_location_id,
  name, address, zipcode, area_label, lat, lng, phones, working_hours,
  raw, cached_at
)
SELECT
  'acs',
  country,
  CASE shop_kind
    WHEN 1 THEN 'central_store'
    WHEN 2 THEN 'branch'
    WHEN 3 THEN 'branch'
    WHEN 4 THEN 'xpress'
    WHEN 5 THEN 'kiosk'
    WHEN 7 THEN 'smartpoint'
    ELSE COALESCE(shop_kind::text, 'unknown')
  END,
  station_id,
  COALESCE(branch_id::text, '1'),
  description,
  address,
  zipcode,
  area_descr,
  lat,
  lng,
  phones,
  working_hours,
  jsonb_strip_nulls(jsonb_build_object(
    'shop_kind', shop_kind,
    'station_id_en', station_id_en,
    'area_id', area_id,
    'area_descr', area_descr,
    'working_hours_sat', working_hours_sat,
    'truck_pickup_hours', truck_pickup_hours,
    'email', email,
    'services', services
  )),
  cached_at
FROM public.acs_station_cache
ON CONFLICT (carrier, country, kind, location_id, sub_location_id) DO NOTHING;

INSERT INTO public.couriers_postcode_cache (
  carrier, country, zipcode,
  station_id, sub_station_id, is_inaccessible, area_label, raw, cached_at
)
SELECT
  'acs',
  country,
  zipcode,
  station_id,
  CASE WHEN branch_id IS NULL THEN NULL ELSE branch_id::text END,
  is_inaccessible,
  area_label,
  NULL,
  cached_at
FROM public.acs_postcode_cache
ON CONFLICT (carrier, country, zipcode) DO NOTHING;
