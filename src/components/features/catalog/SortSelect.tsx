"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { strings } from "@/config/strings";

const OPTIONS = [
  { value: "newest", label: strings.sort.newest },
  { value: "price_asc", label: strings.sort.priceAsc },
  { value: "price_desc", label: strings.sort.priceDesc },
  { value: "name", label: strings.sort.name },
];

/**
 * Catalog sort selector. Writes the chosen order to the `sort` query param
 * (omitting it for the default "newest") and resets pagination. The page
 * reads `sort` and passes it to searchVariants.
 */
export default function SortSelect() {
  const router = useRouter();
  const search = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const current = search.get("sort") ?? "newest";

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(search.toString());
    if (e.target.value === "newest") params.delete("sort");
    else params.set("sort", e.target.value);
    params.delete("page");
    startTransition(() => router.push(`/products?${params.toString()}`));
  }

  return (
    <label className="inline-flex items-center gap-2 shrink-0">
      <span className="text-stone-taupe font-mono uppercase text-[11px] tracking-wider">
        {strings.sort.label}
      </span>
      <select
        value={current}
        onChange={onChange}
        disabled={isPending}
        aria-label={strings.sort.label}
        className="border border-stone-taupe/30 rounded-sm px-2 py-1.5 bg-card text-ink text-sm focus:outline-none focus:border-stone-taupe disabled:opacity-50"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
