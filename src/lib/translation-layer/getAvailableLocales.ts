import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/types/result";

/**
 * Returns the distinct list of locales that have at least one translation.
 */
export const getAvailableLocales = cache(async (): Promise<Result<string[]>> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("translations")
    .select("locale")
    .order("locale");

  if (error) return fail<string[]>(error.message, error.code);

  const locales = Array.from(new Set((data ?? []).map((r: any) => r.locale as string)));
  if (locales.length === 0) {
    locales.push(process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? "el");
  }
  return ok(locales);
});
