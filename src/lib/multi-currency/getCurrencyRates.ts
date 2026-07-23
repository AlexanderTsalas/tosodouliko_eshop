import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { CACHE_TAGS } from "@/lib/cache-tags";

/**
 * Returns a Map<currency_code, exchange_rate> of active currencies.
 *
 * Cached cross-request via Next's `unstable_cache` keyed under the
 * `currencies` tag. Admin currency mutations call `updateTag("currencies")`
 * to bust the cache instantly; otherwise the result lives for the
 * configured TTL.
 *
 * Why admin client: rates are universal (admin-managed, same for every
 * visitor). Using `createAdminClient()` keeps the cache safe from
 * accidental request-scoped state pulling cookies into the cached value.
 */
const getCurrencyRatesInner = async (): Promise<Map<string, number>> => {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("currencies")
    .select("code, exchange_rate")
    .eq("active", true);

  const map = new Map<string, number>();
  for (const r of (data ?? []) as Array<{
    code: string;
    exchange_rate: number;
  }>) {
    map.set(r.code, Number(r.exchange_rate));
  }
  return map;
};

export const getCurrencyRates = unstable_cache(
  getCurrencyRatesInner,
  ["currency-rates"],
  { revalidate: 86400, tags: [CACHE_TAGS.CURRENCIES] }
);

export function convertWithRates(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rates: Map<string, number>
): number {
  if (fromCurrency === toCurrency) return amount;
  const from = rates.get(fromCurrency) ?? 1;
  const to = rates.get(toCurrency) ?? 1;
  return Math.round(((amount * to) / from) * 100) / 100;
}
