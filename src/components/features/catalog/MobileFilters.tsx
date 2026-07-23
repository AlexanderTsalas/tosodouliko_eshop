"use client";

import { useEffect, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import FilterSidebar from "@/components/features/catalog/FilterSidebar";
import type { AttributeFacet } from "@/lib/site-search/getCatalogFacets";
import type { CategoryTreeNode } from "@/types/category-navigation";
import { strings } from "@/config/strings";

/**
 * Mobile-only filters: a "Φίλτρα" trigger + slide-in drawer wrapping the
 * shared FilterSidebar. On md+ the sidebar renders as a column instead (see
 * the products page), so this is hidden there. Closes itself after a
 * successful apply/clear via FilterSidebar's onApplied callback.
 */
export default function MobileFilters({
  facets,
  activeAttributeFilters,
  categories,
  activeCategory,
}: {
  facets: AttributeFacet[];
  activeAttributeFilters: Record<string, string[]>;
  categories: CategoryTreeNode[];
  activeCategory?: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const activeCount = Object.values(activeAttributeFilters).reduce(
    (n, vals) => n + vals.length,
    0
  );

  return (
    <div className="md:hidden mb-4">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 border border-stone-taupe/30 rounded-sm px-3 py-2 text-sm font-medium text-ink bg-card hover:border-stone-taupe transition-colors"
      >
        <SlidersHorizontal className="w-4 h-4" />
        <span>{strings.filters.heading}</span>
        {activeCount > 0 && (
          <span className="text-[10px] font-mono font-bold bg-terracotta text-canvas rounded-full px-1.5 py-0.5 leading-none">
            {activeCount}
          </span>
        )}
      </button>

      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-[60] bg-ink/40 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 z-[70] h-full w-[86%] max-w-sm bg-canvas border-l border-stone-taupe/25 shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={strings.filters.heading}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-taupe/20">
          <span className="font-serif text-lg font-bold text-ink">{strings.filters.heading}</span>
          <button
            onClick={() => setOpen(false)}
            className="p-2 -mr-2 text-ink hover:text-terracotta transition-colors"
            aria-label={strings.categories.closeMenu}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <FilterSidebar
            facets={facets}
            activeAttributeFilters={activeAttributeFilters}
            categories={categories}
            activeCategory={activeCategory}
            onApplied={() => setOpen(false)}
          />
        </div>
      </div>
    </div>
  );
}
