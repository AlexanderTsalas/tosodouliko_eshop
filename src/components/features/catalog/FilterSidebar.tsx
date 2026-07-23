"use client";

import { useState, useEffect, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, X, Search } from "lucide-react";
import type { AttributeFacet } from "@/lib/site-search/getCatalogFacets";
import type { CategoryTreeNode } from "@/types/category-navigation";
import RangeSlider from "@/components/features/catalog/RangeSlider";
import { strings } from "@/config/strings";

interface Props {
  facets?: AttributeFacet[];
  activeAttributeFilters?: Record<string, string[]>;
  /** Category tree for the category selector that scopes the other filters. */
  categories?: CategoryTreeNode[];
  /** Currently-selected category slug (from ?category). */
  activeCategory?: string;
  /** Called after a successful apply/clear/chip-removal — lets a wrapping mobile drawer close. */
  onApplied?: () => void;
}

const VALUE_CAP = 8;
const SEARCH_THRESHOLD = 12;
// Slider domains for the price / age range filters. Full-range = no filter.
const PRICE_MAX = 300;
const AGE_MAX = 14;

export default function FilterSidebar({
  facets = [],
  activeAttributeFilters = {},
  categories = [],
  activeCategory,
  onApplied,
}: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Optimistic checkbox state — the "assemble then Apply" set for ADDING filters.
  const [optimisticFilters, setOptimisticFilters] = useState<Record<string, string[]>>(
    () => activeAttributeFilters
  );
  const [minPrice, setMinPrice] = useState(search.get("minPrice") ?? "");
  const [maxPrice, setMaxPrice] = useState(search.get("maxPrice") ?? "");
  const [ageMin, setAgeMin] = useState(search.get("ageMin") ?? "");
  const [ageMax, setAgeMax] = useState(search.get("ageMax") ?? "");

  // Sections collapsed by default; a facet with active selections starts open.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      facets.map((f) => [f.attributeSlug, (activeAttributeFilters[f.attributeSlug]?.length ?? 0) > 0])
    )
  );
  const [valueSearch, setValueSearch] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setOptimisticFilters(activeAttributeFilters);
    setMinPrice(search.get("minPrice") ?? "");
    setMaxPrice(search.get("maxPrice") ?? "");
    setAgeMin(search.get("ageMin") ?? "");
    setAgeMax(search.get("ageMax") ?? "");
    setOpenSections((prev) => {
      const next = { ...prev };
      for (const f of facets) {
        if ((activeAttributeFilters[f.attributeSlug]?.length ?? 0) > 0) next[f.attributeSlug] = true;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // value → label lookup for active-filter chips.
  const labelFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of facets) for (const v of f.values) map.set(`${f.attributeSlug}::${v.value}`, v.label);
    return (slug: string, value: string) => map.get(`${slug}::${value}`) ?? value;
  }, [facets]);

  const optimisticCount = (slug: string) => optimisticFilters[slug]?.length ?? 0;

  const activeCount =
    Object.values(optimisticFilters).reduce((n, vals) => n + vals.length, 0) +
    (minPrice ? 1 : 0) + (maxPrice ? 1 : 0) + (ageMin ? 1 : 0) + (ageMax ? 1 : 0);

  // ---- Applied-state chips (from the URL, removed immediately) ---------------
  const appliedMinPrice = search.get("minPrice") ?? "";
  const appliedMaxPrice = search.get("maxPrice") ?? "";
  const appliedAgeMin = search.get("ageMin") ?? "";
  const appliedAgeMax = search.get("ageMax") ?? "";

  function pushParams(mutate: (p: URLSearchParams) => void) {
    const params = new URLSearchParams(search.toString());
    mutate(params);
    params.delete("page");
    startTransition(() => {
      router.push(`/products?${params.toString()}`);
      onApplied?.();
    });
  }

  function removeFacetChip(slug: string, value: string) {
    const remaining = (activeAttributeFilters[slug] ?? []).filter((v) => v !== value);
    pushParams((p) => {
      p.delete(slug);
      for (const v of remaining) p.append(slug, v);
    });
  }

  const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
  for (const [slug, values] of Object.entries(activeAttributeFilters)) {
    for (const v of values) {
      chips.push({ key: `${slug}:${v}`, label: labelFor(slug, v), onRemove: () => removeFacetChip(slug, v) });
    }
  }
  if (appliedMinPrice || appliedMaxPrice) {
    chips.push({
      key: "price",
      label: `${strings.filters.priceChip} ${appliedMinPrice || "0"}–${appliedMaxPrice || "∞"}€`,
      onRemove: () => pushParams((p) => { p.delete("minPrice"); p.delete("maxPrice"); }),
    });
  }
  if (appliedAgeMin || appliedAgeMax) {
    chips.push({
      key: "age",
      label: `${strings.filters.ageChip} ${appliedAgeMin || "0"}–${appliedAgeMax || "∞"}`,
      onRemove: () => pushParams((p) => { p.delete("ageMin"); p.delete("ageMax"); }),
    });
  }

  // ---- Apply / clear / toggles ----------------------------------------------
  function apply() {
    pushParams((params) => {
      for (const facet of facets) params.delete(facet.attributeSlug);
      for (const [slug, values] of Object.entries(optimisticFilters)) {
        for (const v of values) params.append(slug, v);
      }
      const set = (key: string, value: string) => (value ? params.set(key, value) : params.delete(key));
      set("minPrice", minPrice);
      set("maxPrice", maxPrice);
      set("ageMin", ageMin);
      set("ageMax", ageMax);
    });
  }

  function clearAll() {
    setOptimisticFilters({});
    setMinPrice(""); setMaxPrice(""); setAgeMin(""); setAgeMax("");
    pushParams((params) => {
      for (const facet of facets) params.delete(facet.attributeSlug);
      ["minPrice", "maxPrice", "ageMin", "ageMax"].forEach((k) => params.delete(k));
    });
  }

  function toggleFacetValue(slug: string, value: string, checked: boolean) {
    setOptimisticFilters((cur) => {
      const current = cur[slug] ?? [];
      const next = checked ? Array.from(new Set([...current, value])) : current.filter((v) => v !== value);
      const updated = { ...cur };
      if (next.length === 0) delete updated[slug];
      else updated[slug] = next;
      return updated;
    });
  }

  return (
    <aside aria-label={strings.filters.heading} className="text-sm">
      {/* Category selector — dictates which attribute filters appear below. */}
      {categories.length > 0 && (
        <div className="pb-4 mb-4 border-b border-stone-taupe/25">
          <h3 className="font-medium uppercase text-xs tracking-wider text-ink mb-2.5">
            {strings.filters.categoryLabel}
          </h3>
          <ul className="space-y-1.5">
            <li>
              <Link
                href="/products"
                className={
                  !activeCategory
                    ? "text-terracotta font-medium"
                    : "text-ink/80 hover:text-terracotta transition-colors"
                }
              >
                {strings.filters.allCategories}
              </Link>
            </li>
            {categories.map((root) => (
              <li key={root.id}>
                <Link
                  href={`/products?category=${root.slug}`}
                  className={
                    activeCategory === root.slug
                      ? "text-terracotta font-medium"
                      : "text-ink/80 hover:text-terracotta transition-colors"
                  }
                >
                  {root.name}
                </Link>
                {root.children.length > 0 && (
                  <ul className="pl-3 mt-1 space-y-1 border-l border-stone-taupe/20">
                    {root.children.map((child) => (
                      <li key={child.id}>
                        <Link
                          href={`/products?category=${child.slug}`}
                          className={
                            activeCategory === child.slug
                              ? "text-terracotta font-medium pl-2 inline-block"
                              : "text-ink/70 hover:text-terracotta transition-colors pl-2 inline-block"
                          }
                        >
                          {child.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-stone-taupe/25">
        <h2 className="font-serif text-lg font-bold text-ink flex items-center gap-2">
          {strings.filters.heading}
          {activeCount > 0 && (
            <span className="text-[10px] font-mono font-bold bg-terracotta text-canvas rounded-full px-1.5 py-0.5 leading-none">
              {activeCount}
            </span>
          )}
        </h2>
        {chips.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-stone-taupe hover:text-terracotta underline transition-colors"
          >
            {strings.filters.clearAll}
          </button>
        )}
      </div>

      {/* Active-filter chips */}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={c.onRemove}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-full border border-terracotta/40 bg-terracotta/10 text-ink text-xs px-2 py-1 hover:bg-terracotta/20 transition-colors disabled:opacity-60"
            >
              <span>{c.label}</span>
              <X className="w-3 h-3" />
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col">
        <div className="divide-y divide-stone-taupe/15">
        {facets.map((facet) => {
          const open = openSections[facet.attributeSlug] ?? false;
          const selCount = optimisticCount(facet.attributeSlug);
          const q = (valueSearch[facet.attributeSlug] ?? "").trim().toLowerCase();
          const filteredValues = q
            ? facet.values.filter((v) => v.label.toLowerCase().includes(q))
            : facet.values;
          const expanded = showAll[facet.attributeSlug] ?? false;
          const shown = expanded ? filteredValues : filteredValues.slice(0, VALUE_CAP);
          const hasMore = filteredValues.length > VALUE_CAP;

          return (
            <fieldset key={facet.attributeSlug} className="py-2.5">
              <legend className="w-full">
                <button
                  type="button"
                  onClick={() =>
                    setOpenSections((c) => ({ ...c, [facet.attributeSlug]: !open }))
                  }
                  className="w-full flex items-center justify-between text-ink font-medium uppercase text-xs tracking-wider hover:text-terracotta transition-colors"
                  aria-expanded={open}
                >
                  <span className="flex items-center gap-2">
                    {facet.attributeName}
                    {selCount > 0 && (
                      <span className="text-[9px] font-mono font-bold bg-terracotta text-canvas rounded-full px-1.5 leading-tight py-0.5">
                        {selCount}
                      </span>
                    )}
                  </span>
                  <ChevronRight
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
                  />
                </button>
              </legend>

              <div className={`cms-accordion ${open ? "is-open" : ""}`}>
                <div className="pt-2.5">
                  {facet.values.length > SEARCH_THRESHOLD && (
                    <div className="flex items-center gap-1.5 mb-2 border border-stone-taupe/25 rounded-sm px-2 py-1 bg-card">
                      <Search className="w-3.5 h-3.5 text-stone-taupe shrink-0" />
                      <input
                        type="text"
                        value={valueSearch[facet.attributeSlug] ?? ""}
                        onChange={(e) =>
                          setValueSearch((c) => ({ ...c, [facet.attributeSlug]: e.target.value }))
                        }
                        placeholder={strings.filters.searchValues}
                        className="bg-transparent text-xs w-full focus:outline-none placeholder:text-stone-taupe/60"
                      />
                    </div>
                  )}
                  <ul className="space-y-1.5">
                    {shown.map((v) => {
                      const active = optimisticFilters[facet.attributeSlug]?.includes(v.value) ?? false;
                      return (
                        <li key={v.value}>
                          <label className="flex items-center justify-between gap-2 cursor-pointer group/f">
                            <span className="flex items-center gap-2 text-ink/80 group-hover/f:text-ink">
                              <input
                                type="checkbox"
                                checked={active}
                                onChange={(e) =>
                                  toggleFacetValue(facet.attributeSlug, v.value, e.target.checked)
                                }
                              />
                              <span>{v.label}</span>
                            </span>
                            <span className="text-xs text-stone-taupe tabular-nums">{v.count}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  {hasMore && (
                    <button
                      type="button"
                      onClick={() =>
                        setShowAll((c) => ({ ...c, [facet.attributeSlug]: !expanded }))
                      }
                      className="mt-2 text-xs text-terracotta hover:underline font-medium"
                    >
                      {expanded
                        ? strings.filters.showLess
                        : `${strings.filters.showMore} (${filteredValues.length - VALUE_CAP})`}
                    </button>
                  )}
                </div>
              </div>
            </fieldset>
          );
        })}

        </div>

        {/* Price */}
        <fieldset className="rounded-lg border border-stone-taupe/20 bg-card px-3.5 py-2.5 mt-3">
          <legend className="font-medium uppercase text-xs tracking-wider text-ink mb-2">
            {strings.filters.priceLabel}
          </legend>
          <RangeSlider
            min={0}
            max={PRICE_MAX}
            step={5}
            unit="€"
            lo={minPrice ? Number(minPrice) : 0}
            hi={maxPrice ? Number(maxPrice) : PRICE_MAX}
            onChange={(lo, hi) => {
              setMinPrice(lo <= 0 ? "" : String(lo));
              setMaxPrice(hi >= PRICE_MAX ? "" : String(hi));
            }}
          />
        </fieldset>

        {/* Age */}
        <fieldset className="rounded-lg border border-stone-taupe/20 bg-card px-3.5 py-2.5 mt-3">
          <legend className="font-medium uppercase text-xs tracking-wider text-ink mb-2">
            {strings.filters.ageLabel}
          </legend>
          <RangeSlider
            min={0}
            max={AGE_MAX}
            step={1}
            lo={ageMin ? Number(ageMin) : 0}
            hi={ageMax ? Number(ageMax) : AGE_MAX}
            onChange={(lo, hi) => {
              setAgeMin(lo <= 0 ? "" : String(lo));
              setAgeMax(hi >= AGE_MAX ? "" : String(hi));
            }}
          />
        </fieldset>
      </div>

      <button
        type="button"
        onClick={apply}
        disabled={isPending}
        className="mt-4 w-full rounded-sm bg-primary text-primary-foreground py-2.5 text-sm font-medium uppercase tracking-wider hover:bg-primary/90 transition-colors disabled:opacity-70"
      >
        {isPending ? strings.filters.applying : strings.filters.apply}
      </button>
    </aside>
  );
}
