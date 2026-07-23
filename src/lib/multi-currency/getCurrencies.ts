import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/types/result";
import type { Currency } from "@/types/multi-currency";

/**
 * Returns all active currencies. Cached per request via React.cache.
 */
export const getCurrencies = cache(async (): Promise<Result<Currency[]>> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("currencies")
    .select("*")
    .eq("active", true)
    .order("code");

  if (error) return fail<Currency[]>(error.message, error.code);
  return ok((data ?? []) as Currency[]);
});
