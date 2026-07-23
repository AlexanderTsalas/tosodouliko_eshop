"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { Currency } from "@/types/multi-currency";

export const ACTIVE_CURRENCY_COOKIE = "pref-currency";

function setCookie(name: string, value: string, days = 365) {
  const expires = new Date(Date.now() + days * 86400 * 1000).toUTCString();
  document.cookie = `${name}=${value}; expires=${expires}; path=/; samesite=lax`;
}

interface Props {
  currencies: Currency[];
  active: string;
}

/**
 * Storefront currency selector. Persists the choice in the `pref-currency`
 * cookie and refreshes the route so server-rendered prices re-compute.
 *
 * The list of currencies is fetched server-side and passed in as a prop so
 * the dropdown is hydrated immediately (no client-side fetch on mount).
 */
export default function CurrencySwitcher({ currencies, active }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (currencies.length === 0) return null;

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    setCookie(ACTIVE_CURRENCY_COOKIE, next);
    startTransition(() => router.refresh());
  }

  return (
    <select
      value={active}
      onChange={handleChange}
      disabled={isPending}
      aria-label="Νόμισμα"
      title="Νόμισμα"
      className="appearance-none bg-transparent cursor-pointer text-ink font-medium text-base leading-none px-1 focus:outline-none hover:opacity-70 transition-opacity disabled:opacity-50"
    >
      {currencies.map((c) => (
        <option key={c.code} value={c.code}>
          {c.symbol}
        </option>
      ))}
    </select>
  );
}
