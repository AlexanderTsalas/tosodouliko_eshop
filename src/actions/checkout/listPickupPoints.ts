"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCapabilities } from "@/lib/courier/getCapabilities";
import { fail, ok, type Result } from "@/types/result";

/**
 * Phase 7 — pickup-point listing for the LocationPicker component.
 *
 * Phase 10 — switched to the unified couriers_location_cache /
 * couriers_postcode_cache tables, keyed by carrier slug. ACS is the only
 * carrier with pickup data wired today; BoxNow / Geniki light up when their
 * provider phases populate cache rows for their slug.
 *
 * Proximity sort:
 *   1. The customer's recipient zipcode is resolved to a lat/lng by reading
 *      the station that serves that zip from couriers_postcode_cache, then
 *      that station's lat/lng from couriers_location_cache. This is free
 *      (no geocoding API) and accurate enough for "closest pickup point"
 *      UX — it places the anchor at the customer's serving-station, which
 *      is near them.
 *   2. Haversine distance computed from anchor to each pickup point.
 *   3. Top N (default 20) returned, sorted ascending.
 *
 * When zipcode can't be anchored (cold cache, no carrier supporting
 * address validation), falls back to unsorted-by-display order. The
 * LocationPicker UI shows a note explaining the limitation in that case.
 */

const Schema = z.object({
  /**
   * Accepts any string slug — built-in or custom. Unknown slugs (carriers
   * without a provider class) silently return empty results, matching the
   * "no pickup points available" UX rather than throwing. Validation
   * against the active carrier set happens at order placement via
   * isCompatible.
   */
  carrier: z.string().max(50).nullable(),
  type: z.enum(["locker", "branch"]),
  country: z.string().length(2).default("GR"),
  /** Recipient zipcode used as the proximity anchor. Optional — when absent the result is unsorted. */
  recipient_zipcode: z.string().optional(),
  /** How many results to return. Default 20 covers a metro area without overwhelming the UI. */
  limit: z.number().int().min(1).max(100).default(20),
});

export interface PickupPoint {
  /** Carrier-opaque location ID. For ACS this is the station_id (e.g. 'ΑΘ'). */
  station_id: string;
  /** ACS branch_id parsed back to integer for legacy consumers. Defaults to 1. */
  branch_id: number;
  /** ACS_SHOP_KIND projected back from the semantic 'kind' for legacy consumers. */
  shop_kind: number;
  name: string;
  address: string | null;
  zipcode: string | null;
  area: string | null;
  phones: string | null;
  working_hours: string | null;
  lat: number | null;
  lng: number | null;
  /** Computed great-circle distance from the recipient anchor, in km. Null when no anchor was available. */
  distance_km: number | null;
}

export interface PickupListResult {
  points: PickupPoint[];
  anchor_lat: number | null;
  anchor_lng: number | null;
  /** True when proximity sort applied. False when the anchor zip couldn't be resolved. */
  proximity_sorted: boolean;
  /**
   * Phase 11 — true when the carrier supports "any-locker" / deferred
   * selection (today: BoxNow with defer_locker_selection capability on).
   * The picker renders an extra row at the top that resolves to
   * station_id='deferred' at order placement.
   */
  deferred_available: boolean;
}

export async function listPickupPoints(
  input: z.input<typeof Schema>
): Promise<Result<PickupListResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<PickupListResult>("Invalid input", "INVALID_INPUT");
  }

  const carrier = parsed.data.carrier;
  if (!carrier) {
    return ok({
      points: [],
      anchor_lat: null,
      anchor_lng: null,
      proximity_sorted: false,
      deferred_available: false,
    });
  }

  // Phase 11 — defer_locker_selection capability gate. Only meaningful
  // for the locker tab; we still resolve it for the branch tab to keep
  // the response shape stable, but the picker only renders the deferred
  // option when tab='locker'.
  const capabilities = await getCapabilities(carrier);
  const deferredAvailable = capabilities.has("defer_locker_selection");

  const admin = createAdminClient();
  const country = parsed.data.country.toUpperCase();

  // Semantic location kind. ACS smartpoints / central stores map directly.
  // BoxNow uses 'locker' for both UI types (BoxNow has no branches), and
  // Geniki uses 'shop' / 'locker'. When the type is requested but the
  // carrier doesn't stock that kind, the cache query just returns empty
  // and the picker renders the "δεν υπάρχουν διαθέσιμα σημεία" note.
  const kind = pickupKindFor(carrier, parsed.data.type);

  // 1. Resolve anchor lat/lng from the recipient zipcode (if provided).
  const { anchorLat, anchorLng } = await resolveAnchor(
    admin,
    carrier,
    country,
    parsed.data.recipient_zipcode?.trim() ?? null
  );

  // 2. Fetch all stations of the requested kind. Cache row count is bounded
  //    by physical carrier inventory (hundreds for branches, low thousands
  //    for Smartpoints/lockers) — fine to pull and sort in JS rather than
  //    pushing the haversine into SQL.
  const { data: stationRows, error } = await admin
    .from("couriers_location_cache")
    .select(
      "location_id, sub_location_id, kind, name, area_label, address, zipcode, phones, working_hours, lat, lng, raw"
    )
    .eq("carrier", carrier)
    .eq("country", country)
    .eq("kind", kind);
  if (error) {
    return fail<PickupListResult>(error.message, "DB_ERROR");
  }

  type Row = {
    location_id: string;
    sub_location_id: string;
    kind: string;
    name: string | null;
    area_label: string | null;
    address: string | null;
    zipcode: string | null;
    phones: string | null;
    working_hours: string | null;
    lat: number | null;
    lng: number | null;
    raw: { shop_kind?: number } | null;
  };
  const rows = (stationRows ?? []) as Row[];

  // 3. Project into PickupPoint, compute distance. The shop_kind projection
  //    is a backward-compat convenience for clients (admin order page,
  //    OrderVoucherActions) that still pass it through to ACS voucher
  //    creation. For non-ACS carriers, raw.shop_kind is undefined and we
  //    fall through to the semantic mapping.
  const points: PickupPoint[] = rows.map((r) => ({
    station_id: r.location_id,
    branch_id: parseBranchId(r.sub_location_id),
    shop_kind: r.raw?.shop_kind ?? shopKindFromKindForLegacyConsumers(r.kind),
    name: r.name?.trim() || r.area_label?.trim() || r.location_id,
    address: r.address,
    zipcode: r.zipcode,
    area: r.area_label,
    phones: r.phones,
    working_hours: r.working_hours,
    lat: r.lat,
    lng: r.lng,
    distance_km:
      anchorLat !== null && anchorLng !== null && r.lat !== null && r.lng !== null
        ? haversineKm(anchorLat, anchorLng, r.lat, r.lng)
        : null,
  }));

  // 4. Sort: distance ascending when available, else by name.
  const proximitySorted = anchorLat !== null && anchorLng !== null;
  if (proximitySorted) {
    points.sort((a, b) => {
      if (a.distance_km === null && b.distance_km === null) return a.name.localeCompare(b.name);
      if (a.distance_km === null) return 1;
      if (b.distance_km === null) return -1;
      return a.distance_km - b.distance_km;
    });
  } else {
    points.sort((a, b) => a.name.localeCompare(b.name));
  }

  // 5. Truncate to limit.
  const sliced = points.slice(0, parsed.data.limit);

  return ok({
    points: sliced,
    anchor_lat: anchorLat,
    anchor_lng: anchorLng,
    proximity_sorted: proximitySorted,
    deferred_available: deferredAvailable,
  });
}

/**
 * Reads couriers_postcode_cache to find which serving location handles the
 * zip for this carrier, then reads that location's lat/lng from
 * couriers_location_cache. Returns nulls when either lookup misses — the
 * caller renders an unsorted list with an explanatory note in that case.
 *
 * Note we look up the serving location across ALL kinds (not just the
 * kind being requested) — the customer's postcode-serving station is
 * typically a central store even when they want a locker, and the
 * lat/lng of either is fine as a proximity anchor.
 */
async function resolveAnchor(
  admin: ReturnType<typeof createAdminClient>,
  carrier: string,
  country: string,
  zipcode: string | null
): Promise<{ anchorLat: number | null; anchorLng: number | null }> {
  if (!zipcode) return { anchorLat: null, anchorLng: null };

  const { data: pcRow } = await admin
    .from("couriers_postcode_cache")
    .select("station_id, sub_station_id")
    .eq("carrier", carrier)
    .eq("country", country)
    .eq("zipcode", zipcode)
    .maybeSingle();
  const pc = pcRow as { station_id: string | null; sub_station_id: string | null } | null;
  if (!pc?.station_id) return { anchorLat: null, anchorLng: null };

  const { data: stRow } = await admin
    .from("couriers_location_cache")
    .select("lat, lng")
    .eq("carrier", carrier)
    .eq("country", country)
    .eq("location_id", pc.station_id)
    .eq("sub_location_id", pc.sub_station_id ?? "1")
    .maybeSingle();
  const st = stRow as { lat: number | null; lng: number | null } | null;
  if (!st || st.lat === null || st.lng === null) {
    return { anchorLat: null, anchorLng: null };
  }
  return { anchorLat: st.lat, anchorLng: st.lng };
}

/**
 * Per-carrier mapping from picker UI type ('locker' / 'branch') to the
 * semantic `kind` text stored in couriers_location_cache. Centralizing
 * here means adding a carrier is a single map entry, not a new query path.
 *
 * ACS_SHOP_KIND mapping notes:
 *   - 1 = central stores → 'central_store' (= 'branch' in customer UX)
 *   - 7 = Smartpoints → 'smartpoint' (= 'locker' in customer UX)
 *   - 2/3 (sub-branches) excluded; merchants haven't requested.
 *   - 4 (Xpress) and 5 (Kiosk) excluded — Xpress is cash-only store
 *     pickups, Kiosk only handles envelopes, neither fit the typical
 *     e-commerce parcel flow.
 */
function pickupKindFor(carrier: string, type: "locker" | "branch"): string {
  if (carrier === "acs") {
    return type === "locker" ? "smartpoint" : "central_store";
  }
  if (carrier === "box_now") {
    // BoxNow has lockers only. A 'branch' request just returns empty —
    // the picker UI handles that with a "δεν υπάρχουν διαθέσιμα σημεία"
    // message rather than 404ing.
    return "locker";
  }
  if (carrier === "geniki") {
    return type === "locker" ? "locker" : "shop";
  }
  // Custom carriers + ELTA/Speedex (no provider yet) use the literal type.
  return type;
}

function parseBranchId(sub: string): number {
  const n = Number.parseInt(sub, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Projects the semantic `kind` text back to an ACS_SHOP_KIND integer for
 * downstream consumers (admin order page, voucher creation) that still
 * use the integer. Inverse of the migration's CASE mapping.
 */
function shopKindFromKindForLegacyConsumers(kind: string): number {
  switch (kind) {
    case "central_store":
      return 1;
    case "branch":
      return 2;
    case "xpress":
      return 4;
    case "kiosk":
      return 5;
    case "smartpoint":
      return 7;
    default:
      return 1;
  }
}

/** Earth's mean radius in km — used by the haversine formula. */
const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const sLat1 = Math.sin(dLat / 2);
  const sLng1 = Math.sin(dLng / 2);
  const a =
    sLat1 * sLat1 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sLng1 * sLng1;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}
