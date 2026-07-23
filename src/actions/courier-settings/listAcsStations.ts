"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadCarrierProvider } from "@/lib/courier/registry";
import { AcsProvider, type AcsStation } from "@/lib/courier/providers/acs";
import { acsKindFromShopKind } from "@/lib/courier/acsKind";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const STATION_CACHE_TTL_DAYS = 30;

const Schema = z.object({
  country: z.string().length(2).default("GR"),
  /** ACS_SHOP_KIND filter — 1=central stores (default), 4=Xpress, 5=Kiosk, 7=Smartpoint. */
  shop_kind: z.number().int().min(1).max(7).default(1),
  /**
   * Force a refresh even if the cache is fresh. The admin "refresh stations"
   * button uses this; the customer picker leaves it false and relies on the
   * 30-day TTL.
   */
  force_refresh: z.boolean().default(false),
});

interface StationDTO {
  station_id: string;
  station_id_en: string | null;
  branch_id: number;
  description: string | null;
  area_descr: string | null;
  address: string | null;
  zipcode: string | null;
  phones: string | null;
  working_hours: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * Reads couriers_location_cache (carrier='acs') for the requested
 * country/kind combination. When the cache is empty or stale (or
 * `force_refresh=true`), pulls fresh data from ACS_Stations and upserts.
 * Falls back to whatever stale data exists if the live call fails —
 * better to show last-known stations than nothing.
 *
 * Open to any authenticated user (the cache table is public-read via RLS),
 * since the customer checkout flow needs it to populate the pickup-branch
 * select.
 */
export async function listAcsStations(
  input: z.input<typeof Schema>
): Promise<Result<StationDTO[]>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<StationDTO[]>("Invalid input", "INVALID_INPUT");

  // TD-2: force_refresh hits the ACS API on every call, bypassing the
  // 30-day cache. Only admin "refresh stations" should trigger this — a
  // public caller passing force_refresh=true could burn the project's
  // ACS API quota. Silently downgrade non-admins to a cached read.
  let forceRefresh = parsed.data.force_refresh;
  if (forceRefresh && !(await checkPermission("manage:couriers"))) {
    forceRefresh = false;
  }

  const admin = createAdminClient();
  const country = parsed.data.country.toUpperCase();
  const shopKind = parsed.data.shop_kind;
  const kind = acsKindFromShopKind(shopKind);

  if (!forceRefresh) {
    const { data: cached } = await admin
      .from("couriers_location_cache")
      .select("*")
      .eq("carrier", "acs")
      .eq("country", country)
      .eq("kind", kind)
      .order("name", { ascending: true });

    const rows = (cached ?? []) as CacheRow[];
    if (rows.length > 0 && !isStale(rows[0].cached_at)) {
      return ok(rows.map(toDTOFromCache));
    }
  }

  // Cache empty / stale / forced — refresh from ACS.
  const provider = await loadCarrierProvider("acs");
  if (!provider || !(provider instanceof AcsProvider)) {
    // No ACS configured — return whatever's cached even if stale, else empty.
    const { data: stale } = await admin
      .from("couriers_location_cache")
      .select("*")
      .eq("carrier", "acs")
      .eq("country", country)
      .eq("kind", kind);
    return ok(((stale ?? []) as CacheRow[]).map(toDTOFromCache));
  }

  try {
    const fresh = await provider.listStations(country, shopKind);
    if (fresh.length > 0) {
      // Wipe the (carrier, country, kind) slice and rewrite — handles ACS
      // removing stations between refreshes.
      await admin
        .from("couriers_location_cache")
        .delete()
        .eq("carrier", "acs")
        .eq("country", country)
        .eq("kind", kind);
      const now = new Date().toISOString();
      await admin.from("couriers_location_cache").insert(
        fresh.map((s) => toCacheRow(s, country, kind, now))
      );
    }
    return ok(fresh.map(toDTOFromStation));
  } catch (e) {
    // Live call failed — fall back to whatever's cached.
    const { data: stale } = await admin
      .from("couriers_location_cache")
      .select("*")
      .eq("carrier", "acs")
      .eq("country", country)
      .eq("kind", kind);
    const rows = (stale ?? []) as CacheRow[];
    if (rows.length === 0) {
      return fail<StationDTO[]>(`ACS_Stations failed: ${(e as Error).message}`, "ACS_ERROR");
    }
    return ok(rows.map(toDTOFromCache));
  }
}

/** Row shape as returned by couriers_location_cache for ACS rows. */
interface CacheRow {
  location_id: string;
  sub_location_id: string;
  name: string | null;
  address: string | null;
  zipcode: string | null;
  area_label: string | null;
  phones: string | null;
  working_hours: string | null;
  lat: number | null;
  lng: number | null;
  raw: { station_id_en?: string | null } | null;
  cached_at: string;
}

function toDTOFromCache(row: CacheRow): StationDTO {
  return {
    station_id: row.location_id,
    station_id_en: row.raw?.station_id_en ?? null,
    branch_id: Number.parseInt(row.sub_location_id || "1", 10) || 1,
    description: row.name,
    area_descr: row.area_label,
    address: row.address,
    zipcode: row.zipcode,
    phones: row.phones,
    working_hours: row.working_hours,
    lat: row.lat,
    lng: row.lng,
  };
}

function toDTOFromStation(s: AcsStation): StationDTO {
  return {
    station_id: s.station_id,
    station_id_en: s.station_id_en,
    branch_id: s.branch_id,
    description: s.description,
    area_descr: s.area_descr,
    address: s.address,
    zipcode: s.zipcode,
    phones: s.phones,
    working_hours: s.working_hours,
    lat: s.lat,
    lng: s.lng,
  };
}

/**
 * Maps an AcsStation (from the ACS_Stations response) to a
 * couriers_location_cache row. ACS-specific fields that don't have a
 * common slot (station_id_en, area_id, services, etc.) go into `raw` so
 * they survive round-tripping.
 */
function toCacheRow(
  s: AcsStation,
  country: string,
  kind: string,
  cachedAt: string
): Record<string, unknown> {
  return {
    carrier: "acs",
    country,
    kind,
    location_id: s.station_id,
    sub_location_id: String(s.branch_id ?? 1),
    name: s.description,
    address: s.address,
    zipcode: s.zipcode,
    area_label: s.area_descr,
    lat: s.lat,
    lng: s.lng,
    phones: s.phones,
    working_hours: s.working_hours,
    raw: {
      shop_kind: s.shop_kind,
      station_id_en: s.station_id_en,
      area_id: s.area_id,
      working_hours_sat: s.working_hours_sat,
      truck_pickup_hours: s.truck_pickup_hours,
      email: s.email,
      services: s.services,
    },
    cached_at: cachedAt,
  };
}

function isStale(timestampIso: string): boolean {
  const ageMs = Date.now() - new Date(timestampIso).getTime();
  return ageMs > STATION_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
}
