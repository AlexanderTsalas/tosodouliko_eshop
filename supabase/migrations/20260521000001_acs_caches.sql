-- =============================================================================
-- ACS lookup caches.
--
-- The carrier integration hits two read-only endpoints whose responses change
-- rarely (postcode → station mapping, station list). Caching them locally
-- keeps the order-quote latency under a second on the common path and avoids
-- burning the ACS rate-limit budget on every checkout.
--
-- TTL is enforced application-side via `cached_at` — a row older than 30 days
-- is refreshed lazily on next lookup. Stale data is acceptable for ~30 days
-- because postcodes/stations turn over slowly; aggressive invalidation would
-- defeat the purpose of the cache.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- acs_postcode_cache
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.acs_postcode_cache (
  country         text NOT NULL,
  zipcode         text NOT NULL,
  -- Resolved Station_ID (Greek 2-3 letter code, e.g., 'ΑΘ'). Null when ACS
  -- doesn't know the zipcode — we still cache the negative result so we don't
  -- thrash the API on every order to a bad postcode.
  station_id      text,
  branch_id       integer,
  -- True when ACS marks at least one area under this zipcode as inaccessible
  -- (remote, additional cost). The order flow surfaces this so the merchant
  -- can warn the customer.
  is_inaccessible boolean NOT NULL DEFAULT false,
  -- Convenience: a human-readable area label kept for admin debugging.
  area_label      text,
  cached_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (country, zipcode)
);

CREATE INDEX IF NOT EXISTS idx_acs_postcode_cache_station
  ON public.acs_postcode_cache(station_id);

ALTER TABLE public.acs_postcode_cache ENABLE ROW LEVEL SECURITY;

-- Read-only for any authenticated user — the data is non-sensitive and the
-- checkout flow needs it. Writes happen exclusively via the admin client.
CREATE POLICY "acs_postcode_cache_public_read"
  ON public.acs_postcode_cache FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "acs_postcode_cache_admin_write"
  ON public.acs_postcode_cache FOR ALL TO authenticated
  USING (public.has_permission('manage:couriers'))
  WITH CHECK (public.has_permission('manage:couriers'));

-- ---------------------------------------------------------------------------
-- acs_station_cache
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.acs_station_cache (
  -- Greek station code (e.g., 'ΑΘ', 'ΘΣ') + branch number form the composite key.
  station_id          text NOT NULL,
  branch_id           integer NOT NULL DEFAULT 1,
  -- 1=central, 2/3=subbranches, 4=Xpress, 5=Kiosk, 7=Smartpoint.
  -- Driven by the ACS_SHOP_KIND filter when populating.
  shop_kind           integer,
  country             text NOT NULL DEFAULT 'GR',
  station_id_en       text,
  description         text,
  area_id             integer,
  area_descr          text,
  address             text,
  zipcode             text,
  phones              text,
  working_hours       text,
  working_hours_sat   text,
  truck_pickup_hours  text,
  lat                 numeric(10, 7),
  lng                 numeric(10, 7),
  email               text,
  services            text,
  cached_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (station_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_acs_station_cache_country
  ON public.acs_station_cache(country);
CREATE INDEX IF NOT EXISTS idx_acs_station_cache_zipcode
  ON public.acs_station_cache(zipcode);

ALTER TABLE public.acs_station_cache ENABLE ROW LEVEL SECURITY;

-- Same read-everyone / write-admin shape as the postcode cache. The customer
-- checkout reads this to populate the "pick up at branch" select.
CREATE POLICY "acs_station_cache_public_read"
  ON public.acs_station_cache FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "acs_station_cache_admin_write"
  ON public.acs_station_cache FOR ALL TO authenticated
  USING (public.has_permission('manage:couriers'))
  WITH CHECK (public.has_permission('manage:couriers'));
