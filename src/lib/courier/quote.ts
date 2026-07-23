import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadCarrierProvider } from "./registry";
import { getCapabilities } from "./getCapabilities";
import { AcsProvider } from "./providers/acs";
import type { PriceQuote } from "./provider";
import type { Carrier } from "@/types/order-history";

/** Cache TTL — postcode → station mapping changes very rarely. */
const POSTCODE_CACHE_TTL_DAYS = 30;

/**
 * Inputs needed for a per-order shipping quote. The order flow assembles
 * these from the cart + the customer's chosen delivery details.
 */
export interface QuoteContext {
  carrier: Carrier;
  recipient_zipcode: string;
  recipient_country?: string;
  weight_kg: number;
  cod_amount?: number;
  item_quantity?: number;
  dimension_x_cm?: number;
  dimension_y_cm?: number;
  dimension_z_cm?: number;
  /** When the customer picked a specific ACS station for pickup. */
  station_destination?: string | null;
}

export interface QuoteResult {
  quote: PriceQuote;
  carrier: Carrier;
  /** True when the destination postcode is flagged as inaccessible/remote. */
  is_inaccessible: boolean;
}

/**
 * Best-effort: returns a normalized quote for the order's carrier, or null
 * if the carrier isn't configured / credentials are missing / the API
 * errors out. Callers MUST treat null as "no audit data available" — they
 * never bubble carrier failures up to the customer at checkout time.
 *
 * Postcode → station resolution is read-through cached in
 * couriers_postcode_cache (carrier='acs', 30-day TTL). Negative results are
 * cached too so a malformed zipcode doesn't thrash the API on every checkout
 * retry.
 */
export async function fetchCarrierQuote(
  ctx: QuoteContext
): Promise<QuoteResult | null> {
  if (!ctx.recipient_zipcode || ctx.weight_kg <= 0) return null;

  const provider = await loadCarrierProvider(ctx.carrier);
  if (!provider) return null;

  // ACS is the only carrier with a real implementation as of Phase 3. Other
  // carriers fall through to null until their phases ship.
  if (!(provider instanceof AcsProvider)) return null;

  // Phase 4 — gate each API branch on its corresponding capability. Admins
  // can disable `fetch_price_quote` while keeping `address_validation` on
  // (the "Merchant A" scenario — wants serviceability checks but not API
  // pricing). When pricing is off we still attempt address validation so
  // the inaccessibility flag is available for the checkout banner.
  const capabilities = await getCapabilities(ctx.carrier);
  const canValidateAddress = capabilities.has("address_validation");
  const canFetchPrice = capabilities.has("fetch_price_quote");

  // If neither capability is on, the provider call would do nothing useful.
  if (!canValidateAddress && !canFetchPrice) return null;

  try {
    const country = (ctx.recipient_country ?? "GR").toUpperCase();
    let stationId: string | null = null;
    let isInaccessible = false;
    if (canValidateAddress) {
      const resolved = await resolveAcsStationCached(
        provider,
        ctx.recipient_zipcode,
        country
      );
      stationId = resolved.stationId;
      isInaccessible = resolved.isInaccessible;
    }

    // No price quote → return early with just the inaccessibility result.
    // The fee resolver treats a null quote as "fall back to custom rules"
    // and the inaccessibility flag still drives the checkout banner.
    if (!canFetchPrice) {
      return null;
    }

    if (!stationId) {
      // ACS couldn't resolve a station for this zipcode — quote will fail.
      // Return null so the resolver falls back to custom rules.
      return null;
    }

    // Phase 5 — derive whether to apply the remote-area surcharge. Fires
    // when the postcode IS inaccessible AND the admin has enabled the
    // capability (off = customer pays the standard rate; the merchant
    // absorbs the surcharge themselves).
    const applyRem = isInaccessible && capabilities.has("apply_remote_surcharge");

    const quote = await provider.priceCalculate({
      recipient_zipcode: ctx.recipient_zipcode,
      recipient_country: country,
      weight_kg: ctx.weight_kg,
      cod_amount: ctx.cod_amount,
      item_quantity: ctx.item_quantity,
      dimension_x_cm: ctx.dimension_x_cm,
      dimension_y_cm: ctx.dimension_y_cm,
      dimension_z_cm: ctx.dimension_z_cm,
      // Pre-resolved station bypasses the second cache check inside the provider.
      station_destination: ctx.station_destination
        ? Number(ctx.station_destination)
        : null,
      apply_remote_surcharge: applyRem,
    });

    return { quote, carrier: ctx.carrier, is_inaccessible: isInaccessible };
  } catch (e) {
    console.error("[carrier] quote failed:", (e as Error).message);
    return null;
  }
}

interface AcsCachedStation {
  stationId: string | null;
  isInaccessible: boolean;
}

/**
 * Reads couriers_postcode_cache (carrier='acs'); on miss/stale, calls
 * ACS_Area_Find_By_Zip_Code and upserts. Negative results (station_id null)
 * are cached too so a bad postcode doesn't trigger a network round-trip
 * every checkout.
 */
async function resolveAcsStationCached(
  provider: AcsProvider,
  zipcode: string,
  country: string
): Promise<AcsCachedStation> {
  const admin = createAdminClient();
  const { data: cached } = await admin
    .from("couriers_postcode_cache")
    .select("station_id, is_inaccessible, cached_at")
    .eq("carrier", "acs")
    .eq("country", country)
    .eq("zipcode", zipcode)
    .maybeSingle();

  if (cached && !isStale((cached as { cached_at: string }).cached_at)) {
    const row = cached as { station_id: string | null; is_inaccessible: boolean };
    return { stationId: row.station_id, isInaccessible: row.is_inaccessible };
  }

  let resolved: AcsCachedStation;
  try {
    const a = await provider.findAreaByZip(zipcode, country);
    resolved = { stationId: a.station_id, isInaccessible: a.is_inaccessible };
    // Upsert is best-effort — failure to cache shouldn't break the quote.
    await admin.from("couriers_postcode_cache").upsert(
      {
        carrier: "acs",
        country,
        zipcode,
        station_id: a.station_id,
        sub_station_id: a.branch_id != null ? String(a.branch_id) : null,
        is_inaccessible: a.is_inaccessible,
        area_label: a.area_label,
        cached_at: new Date().toISOString(),
      },
      { onConflict: "carrier,country,zipcode" }
    );
  } catch (e) {
    console.error("[carrier] findAreaByZip failed:", (e as Error).message);
    // Fall back to whatever stale value we may have; otherwise return null.
    if (cached) {
      const row = cached as { station_id: string | null; is_inaccessible: boolean };
      resolved = { stationId: row.station_id, isInaccessible: row.is_inaccessible };
    } else {
      resolved = { stationId: null, isInaccessible: false };
    }
  }

  return resolved;
}

function isStale(timestampIso: string): boolean {
  const ageMs = Date.now() - new Date(timestampIso).getTime();
  return ageMs > POSTCODE_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
}
