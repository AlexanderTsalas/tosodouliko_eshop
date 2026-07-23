"use client";

import { useState } from "react";
import type { ProductSpecificationView } from "@/types/product-specifications";
import { strings } from "@/config/strings";

/**
 * Tabbed container for the product's Περιγραφή (description) and Προδιαγραφές
 * (specs) — click a tab to toggle which one shows. Renders only the tabs that
 * have content; nothing at all when both are empty.
 */
export default function ProductInfoTabs({
  description,
  specs,
}: {
  description: string | null;
  specs: ProductSpecificationView[];
}) {
  const hasDesc = !!description?.trim();
  const hasSpecs = specs.length > 0;
  const [tab, setTab] = useState<"description" | "specs">(
    hasDesc ? "description" : "specs"
  );

  if (!hasDesc && !hasSpecs) return null;

  const tabClass = (active: boolean) =>
    `px-5 py-3 font-serif text-lg font-bold transition-colors -mb-px border-b-2 ${
      active
        ? "text-terracotta border-terracotta"
        : "text-ink/55 border-transparent hover:text-ink"
    }`;

  return (
    <div className="rounded-sm border border-stone-taupe/20 bg-card overflow-hidden shadow-[0_12px_34px_-14px_rgba(43,36,32,0.28)]">
      <div className="flex border-b border-stone-taupe/20">
        {hasDesc && (
          <button
            type="button"
            onClick={() => setTab("description")}
            aria-selected={tab === "description"}
            className={tabClass(tab === "description")}
          >
            {strings.products.descriptionHeading}
          </button>
        )}
        {hasSpecs && (
          <button
            type="button"
            onClick={() => setTab("specs")}
            aria-selected={tab === "specs"}
            className={tabClass(tab === "specs")}
          >
            {strings.products.specsHeading}
          </button>
        )}
      </div>

      <div className="p-6 sm:p-8">
        {tab === "description" && hasDesc && (
          <p className="text-ink/80 leading-relaxed whitespace-pre-line">{description}</p>
        )}
        {tab === "specs" && hasSpecs && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
            {specs.map((s) => (
              <div key={s.id} className="contents">
                <dt className="text-stone-taupe">{s.attribute_name}</dt>
                <dd className="font-medium text-ink">{s.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
