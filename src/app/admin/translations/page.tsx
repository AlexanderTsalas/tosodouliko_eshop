import { createClient } from "@/lib/supabase/server";
import TranslationsEditor from "@/components/admin/translations/TranslationsEditor";
import type { Translation } from "@/types/translation-layer";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Μεταφράσεις — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminTranslationsPage(
  props: {
    searchParams: Promise<{ ns?: string; locale?: string }>;
  }
) {
  await requirePermission("manage:translations");
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  let query = supabase
    .from("translations")
    .select("*")
    .order("namespace")
    .order("key")
    .limit(1000);

  if (searchParams.ns) query = query.eq("namespace", searchParams.ns);
  if (searchParams.locale) query = query.eq("locale", searchParams.locale);

  const { data } = await query;

  // Distinct lookups for filter dropdowns.
  const { data: nsData } = await supabase
    .from("translations")
    .select("namespace")
    .order("namespace");
  const { data: localeData } = await supabase
    .from("translations")
    .select("locale")
    .order("locale");

  const namespaces = Array.from(new Set(((nsData ?? []) as { namespace: string }[]).map((r) => r.namespace)));
  const locales = Array.from(new Set(((localeData ?? []) as { locale: string }[]).map((r) => r.locale)));

  return (
    <>
      <h1 className="text-2xl font-semibold mb-4">Μεταφράσεις</h1>

      <form className="flex gap-2 mb-4 text-sm">
        <select name="ns" defaultValue={searchParams.ns ?? ""} className="border rounded px-3 py-1">
          <option value="">Όλα τα namespaces</option>
          {namespaces.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select name="locale" defaultValue={searchParams.locale ?? ""} className="border rounded px-3 py-1">
          <option value="">Όλες οι γλώσσες</option>
          {locales.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <button type="submit" className="rounded border px-3 py-1">Φιλτράρισμα</button>
      </form>

      <TranslationsEditor initial={(data ?? []) as Translation[]} />
    </>
  );
}
