import { cache } from "react";

/**
 * Default site currency. Sourced from NEXT_PUBLIC_DEFAULT_CURRENCY at build
 * time, falls back to EUR.
 */
export const getDefaultCurrency = cache((): string => {
  return process.env.NEXT_PUBLIC_DEFAULT_CURRENCY ?? "EUR";
});
