"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type CourierTab = "carriers" | "methods" | "api" | "prefixes";

interface Props {
  active: CourierTab;
  /** Override the base path if mounted elsewhere. Defaults to current pathname. */
  basePath?: string;
  /** Optional badges per tab (e.g. counts). */
  counts?: Partial<Record<CourierTab, number>>;
}

const TABS: { value: CourierTab; label: string }[] = [
  { value: "carriers", label: "Μεταφορικές" },
  { value: "methods", label: "Τρόποι παράδοσης" },
  { value: "prefixes", label: "Μεγέθη πακέτου" },
  { value: "api", label: "API integrations" },
];

/**
 * URL-driven tab navigation for the admin couriers page. Uses
 * `?tab=<value>` so each tab is deep-linkable, browser-back-friendly,
 * and survives a hard refresh.
 *
 * Renders as a row of <Link>s — Next.js handles the navigation with no
 * full reload because the surrounding page is a Server Component reading
 * searchParams.tab.
 */
export default function CourierTabs({ active, basePath, counts }: Props) {
  const pathname = usePathname();
  const base = basePath ?? pathname;

  return (
    <nav className="cms-tabs" aria-label="Καρτέλες">
      {TABS.map((t) => {
        const isActive = active === t.value;
        const count = counts?.[t.value];
        return (
          <Link
            key={t.value}
            href={`${base}?tab=${t.value}`}
            scroll={false}
            aria-current={isActive ? "page" : undefined}
            className="cms-tab"
          >
            {t.label}
            {typeof count === "number" && (
              <span className="cms-tab-count">{count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
