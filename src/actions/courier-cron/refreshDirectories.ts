"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { loadCarrierProvider } from "@/lib/courier/registry";
import { AcsProvider, type AcsStation } from "@/lib/courier/providers/acs";
import { BoxNowProvider, type BoxNowLocker } from "@/lib/courier/providers/boxnow";
import { GenikiProvider, type GenikiLocation } from "@/lib/courier/providers/geniki";
import { acsKindFromShopKind } from "@/lib/courier/acsKind";
import { getCapabilities } from "@/lib/courier/getCapabilities";
import type { Carrier } from "@/types/order-history";

/**
 * Phase 10 — periodic refresh of the carrier directory caches
 * (couriers_location_cache). Called weekly by pg_cron via
 * /api/cron/courier-directories.
 *
 * For each active carrier with the relevant `list_*` capability, pulls
 * fresh data from the provider's directory endpoint and rewrites the
 * (carrier, country, kind) cache slice. Failures on one carrier don't
 * block the others — each carrier's outcome is reported individually.
 *
 * Country is currently hardcoded to 'GR'. When multi-country shipping
 * lands the action can be parameterized.
 *
 * NOT permission-gated when invoked from this module — caller (HTTP
 * route, server action, admin button) is responsible for auth. The route
 * uses CRON_SECRET.
 */

export interface RefreshSlice {
  carrier: string;
  kind: string;
  /** Rows written to the cache. 0 with ok=true means the provider returned no data. */
  count: number;
  ok: boolean;
  message?: string;
}

export interface RefreshDirectoriesResult {
  slices: RefreshSlice[];
  /** Carriers seen as active but skipped because no relevant capability was enabled. */
  skipped: Array<{ carrier: string; reason: string }>;
  /** Total cache rows written across all slices. */
  total_written: number;
}

export async function refreshDirectories(): Promise<RefreshDirectoriesResult> {
  const admin = createAdminClient();
  const slices: RefreshSlice[] = [];
  const skipped: RefreshDirectoriesResult["skipped"] = [];

  // Discover which carriers to refresh from delivery_carriers, NOT from
  // listActiveCarriers — the cron should keep the cache warm even for
  // is_active=false carriers the admin may re-enable shortly. Filtering
  // on `list_smartpoints` / `list_branches` capability is the gate.
  const { data: rows } = await admin
    .from("delivery_carriers")
    .select("slug, is_custom")
    .eq("is_custom", false);
  const builtIns = (rows ?? []) as Array<{ slug: string; is_custom: boolean }>;

  for (const row of builtIns) {
    // Each carrier's refresh is wrapped — one carrier throwing must not
    // halt the whole sweep, since the next carrier might be the one the
    // admin actually depends on.
    try {
      const carrierSlug = row.slug as Carrier;
      const capabilities = await getCapabilities(carrierSlug);
      const wantsBranches = capabilities.has("list_branches");
      const wantsSmartpoints = capabilities.has("list_smartpoints");
      if (!wantsBranches && !wantsSmartpoints) {
        skipped.push({
          carrier: row.slug,
          reason: "no list_branches or list_smartpoints capability enabled",
        });
        continue;
      }

      const provider = await loadCarrierProvider(carrierSlug);
      if (!provider) {
        skipped.push({
          carrier: row.slug,
          reason: "provider not configured or credentials missing",
        });
        continue;
      }

      // Per-carrier dispatch. Geniki will land in Phase 12.
      if (provider instanceof AcsProvider) {
        if (wantsBranches) {
          slices.push(await refreshAcsKind(admin, provider, "GR", 1));
        }
        if (wantsSmartpoints) {
          slices.push(await refreshAcsKind(admin, provider, "GR", 7));
        }
      } else if (provider instanceof BoxNowProvider) {
        // BoxNow has lockers only — no branches concept. Always treat
        // wantsSmartpoints as the gate (list_branches is irrelevant).
        if (wantsSmartpoints) {
          slices.push(await refreshBoxNowLockers(admin, provider, "GR"));
        } else {
          skipped.push({
            carrier: row.slug,
            reason: "BoxNow requires list_smartpoints capability",
          });
        }
      } else if (provider instanceof GenikiProvider) {
        // Geniki has both retail shops AND lockers; refresh whichever
        // the capability set asks for.
        if (wantsBranches) {
          slices.push(await refreshGenikiKind(admin, provider, "GR", "shop"));
        }
        if (wantsSmartpoints) {
          slices.push(await refreshGenikiKind(admin, provider, "GR", "locker"));
        }
      } else {
        skipped.push({
          carrier: row.slug,
          reason: "provider implementation has no directory refresh wired",
        });
      }
    } catch (e) {
      slices.push({
        carrier: row.slug,
        kind: "unknown",
        count: 0,
        ok: false,
        message: (e as Error).message,
      });
    }
  }

  const total_written = slices
    .filter((s) => s.ok)
    .reduce((sum, s) => sum + s.count, 0);
  return { slices, skipped, total_written };
}

async function refreshAcsKind(
  admin: ReturnType<typeof createAdminClient>,
  provider: AcsProvider,
  country: string,
  shopKind: number
): Promise<RefreshSlice> {
  const kind = acsKindFromShopKind(shopKind);
  try {
    const fresh = await provider.listStations(country, shopKind);
    if (fresh.length === 0) {
      return { carrier: "acs", kind, count: 0, ok: true };
    }
    // Wipe-and-rewrite handles ACS removing stations between refreshes.
    await admin
      .from("couriers_location_cache")
      .delete()
      .eq("carrier", "acs")
      .eq("country", country)
      .eq("kind", kind);
    const now = new Date().toISOString();
    const { error } = await admin
      .from("couriers_location_cache")
      .insert(fresh.map((s) => toCacheRow(s, country, kind, now)));
    if (error) {
      return { carrier: "acs", kind, count: 0, ok: false, message: error.message };
    }
    return { carrier: "acs", kind, count: fresh.length, ok: true };
  } catch (e) {
    return {
      carrier: "acs",
      kind,
      count: 0,
      ok: false,
      message: (e as Error).message,
    };
  }
}

async function refreshBoxNowLockers(
  admin: ReturnType<typeof createAdminClient>,
  provider: BoxNowProvider,
  country: string
): Promise<RefreshSlice> {
  const kind = "locker";
  try {
    const fresh = await provider.listLockers(country);
    if (fresh.length === 0) {
      return { carrier: "box_now", kind, count: 0, ok: true };
    }
    await admin
      .from("couriers_location_cache")
      .delete()
      .eq("carrier", "box_now")
      .eq("country", country)
      .eq("kind", kind);
    const now = new Date().toISOString();
    const { error } = await admin
      .from("couriers_location_cache")
      .insert(fresh.map((l) => toBoxNowCacheRow(l, country, now)));
    if (error) {
      return { carrier: "box_now", kind, count: 0, ok: false, message: error.message };
    }
    return { carrier: "box_now", kind, count: fresh.length, ok: true };
  } catch (e) {
    return {
      carrier: "box_now",
      kind,
      count: 0,
      ok: false,
      message: (e as Error).message,
    };
  }
}

async function refreshGenikiKind(
  admin: ReturnType<typeof createAdminClient>,
  provider: GenikiProvider,
  country: string,
  kind: "shop" | "locker"
): Promise<RefreshSlice> {
  try {
    const fresh =
      kind === "shop" ? await provider.listShops() : await provider.listLockers();
    if (fresh.length === 0) {
      return { carrier: "geniki", kind, count: 0, ok: true };
    }
    await admin
      .from("couriers_location_cache")
      .delete()
      .eq("carrier", "geniki")
      .eq("country", country)
      .eq("kind", kind);
    const now = new Date().toISOString();
    const { error } = await admin
      .from("couriers_location_cache")
      .insert(fresh.map((l) => toGenikiCacheRow(l, country, kind, now)));
    if (error) {
      return { carrier: "geniki", kind, count: 0, ok: false, message: error.message };
    }
    return { carrier: "geniki", kind, count: fresh.length, ok: true };
  } catch (e) {
    return {
      carrier: "geniki",
      kind,
      count: 0,
      ok: false,
      message: (e as Error).message,
    };
  }
}

function toGenikiCacheRow(
  l: GenikiLocation,
  country: string,
  kind: "shop" | "locker",
  cachedAt: string
): Record<string, unknown> {
  return {
    carrier: "geniki",
    country,
    kind,
    location_id: l.location_id,
    sub_location_id: "",
    name: l.name,
    address: l.address,
    zipcode: l.zipcode,
    area_label: l.area,
    lat: l.lat,
    lng: l.lng,
    phones: l.phones,
    working_hours: l.working_hours,
    raw: null,
    cached_at: cachedAt,
  };
}

function toBoxNowCacheRow(
  l: BoxNowLocker,
  country: string,
  cachedAt: string
): Record<string, unknown> {
  return {
    carrier: "box_now",
    country,
    kind: "locker",
    location_id: l.locker_id,
    sub_location_id: "",
    name: l.name,
    address: l.address,
    zipcode: l.zipcode,
    area_label: l.area,
    lat: l.lat,
    lng: l.lng,
    phones: null,
    working_hours: null,
    raw: l.raw,
    cached_at: cachedAt,
  };
}

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
