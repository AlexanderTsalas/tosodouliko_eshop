import { createClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/types/result";
import type { ShippingRate } from "@/types/shipping";

/**
 * Returns active shipping rates that match the given country code. Performs
 * a join from country → zone → rates.
 */
export async function getShippingMethods(
  countryCode: string
): Promise<Result<ShippingRate[]>> {
  const supabase = await createClient();

  const { data: zones, error: zonesError } = await supabase
    .from("shipping_zones")
    .select("id, country_codes")
    .eq("active", true);

  if (zonesError) return fail<ShippingRate[]>(zonesError.message, zonesError.code);

  const matchingZoneIds = (zones ?? [])
    .filter((z: any) => Array.isArray(z.country_codes) && z.country_codes.includes(countryCode))
    .map((z: any) => z.id as string);

  if (matchingZoneIds.length === 0) {
    return ok([]);
  }

  const { data, error } = await supabase
    .from("shipping_rates")
    .select("*")
    .in("zone_id", matchingZoneIds)
    .eq("active", true);

  if (error) return fail<ShippingRate[]>(error.message, error.code);
  return ok((data ?? []) as ShippingRate[]);
}
