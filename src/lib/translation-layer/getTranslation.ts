import { getTranslations } from "./getTranslations";

/**
 * Single-key translation lookup. Falls back to the key itself if no row exists.
 */
export async function getTranslation(
  namespace: string,
  key: string,
  locale = process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? "el"
): Promise<string> {
  const result = await getTranslations(namespace, locale);
  if (!result.success) return key;
  return result.data[key] ?? key;
}
