import { cookies } from "next/headers";

export const ACTIVE_CURRENCY_COOKIE = "pref-currency";

/**
 * Server-side: returns the currency the user has chosen via the
 * CurrencySwitcher (stored in the `pref-currency` cookie), or the site default.
 *
 * Always validated to be a 3-letter uppercase code so a malicious cookie value
 * can't break price formatting.
 */
export async function getActiveCurrency(): Promise<string> {
  const fallback = process.env.NEXT_PUBLIC_DEFAULT_CURRENCY ?? "EUR";
  const cookieStore = await cookies();
  const c = cookieStore.get(ACTIVE_CURRENCY_COOKIE)?.value;
  if (c && /^[A-Z]{3}$/.test(c)) return c;
  return fallback;
}
