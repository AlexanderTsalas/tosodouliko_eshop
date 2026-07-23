import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/types/result";
import type { TranslationMap } from "@/types/translation-layer";

/**
 * Fetch all translations for a namespace + locale. Cached per request.
 */
export const getTranslations = cache(
  async (
    namespace: string,
    locale = process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? "el"
  ): Promise<Result<TranslationMap>> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("translations")
      .select("key, value")
      .eq("namespace", namespace)
      .eq("locale", locale);

    if (error) return fail<TranslationMap>(error.message, error.code);

    const map: TranslationMap = {};
    for (const row of data ?? []) {
      map[(row as any).key] = (row as any).value;
    }
    return ok(map);
  }
);
