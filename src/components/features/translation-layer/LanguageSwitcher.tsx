"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Locale → country flag emoji. Falls back to the uppercase code. */
const FLAGS: Record<string, string> = {
  el: "🇬🇷",
  en: "🇬🇧",
  gr: "🇬🇷",
  us: "🇺🇸",
};

export default function LanguageSwitcher({
  defaultLocale = "el",
}: {
  defaultLocale?: string;
}) {
  const [locales, setLocales] = useState<string[]>([]);
  const [selected, setSelected] = useState(defaultLocale);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("translations")
        .select("locale");
      if (cancelled) return;
      const set = Array.from(
        new Set(((data ?? []) as { locale: string }[]).map((r) => r.locale))
      );
      if (set.length === 0) set.push(defaultLocale);
      setLocales(set);
    })();
    return () => {
      cancelled = true;
    };
  }, [defaultLocale]);

  if (locales.length === 0) return null;

  return (
    <select
      value={selected}
      onChange={(e) => setSelected(e.target.value)}
      aria-label="Γλώσσα"
      title="Γλώσσα"
      className="appearance-none bg-transparent cursor-pointer text-lg leading-none px-1 focus:outline-none hover:opacity-70 transition-opacity"
    >
      {locales.map((l) => (
        <option key={l} value={l}>
          {FLAGS[l.toLowerCase()] ?? l.toUpperCase()}
        </option>
      ))}
    </select>
  );
}
