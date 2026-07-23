import Link from "next/link";

/**
 * Filter-bar slot config. Each slot becomes one filter input rendered in a
 * GET form. Submitting the form updates the current page's URL params.
 */
export type FilterSlot =
  | {
      type: "search";
      key: string;
      label?: string;
      placeholder?: string;
    }
  | {
      type: "select";
      key: string;
      label: string;
      options: Array<{ value: string; label: string }>;
      /** Label for the "any value" option at the top. */
      anyLabel?: string;
    };

interface Props {
  slots: FilterSlot[];
  /** Current values keyed by slot.key, taken from URL params. */
  values: Record<string, string>;
  /** Where the form posts to — usually the current pathname. */
  action?: string;
  /**
   * Hidden URL params to preserve across filter submits (e.g. selection
   * state should NOT be preserved — applying a new filter should clear it —
   * but pagination should reset to 1 on filter change).
   */
  preserve?: Record<string, string>;
}

/**
 * Reusable filter bar for admin list pages. Renders a GET <form> so the
 * filters are URL-driven (refresh-safe, deep-linkable, shareable).
 *
 * Configured via slots so the same component serves products, inventory,
 * supply orders, etc. — each page passes the relevant filter set.
 *
 * A "clear all" link resets all slot values while preserving the `preserve`
 * params.
 */
export default function CatalogFilterBar({
  slots,
  values,
  action,
  preserve = {},
}: Props) {
  const hasAnyActive = slots.some((slot) => {
    const v = values[slot.key];
    return v !== undefined && v !== "" && v !== "all";
  });

  // Build "clear all" URL: only the preserve params.
  const clearParams = new URLSearchParams();
  for (const [k, v] of Object.entries(preserve)) {
    if (v) clearParams.set(k, v);
  }
  const clearHref = action
    ? `${action}?${clearParams.toString()}`
    : `?${clearParams.toString()}`;

  return (
    <form
      action={action}
      method="GET"
      className="flex flex-wrap items-end gap-2 mb-4 text-sm"
    >
      {Object.entries(preserve).map(([k, v]) =>
        v ? <input key={k} type="hidden" name={k} value={v} /> : null
      )}

      {slots.map((slot) => {
        if (slot.type === "search") {
          return (
            <label
              key={slot.key}
              className="flex flex-col gap-1 min-w-[220px] flex-1"
            >
              {slot.label && (
                <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
                  {slot.label}
                </span>
              )}
              <input
                type="search"
                name={slot.key}
                defaultValue={values[slot.key] ?? ""}
                placeholder={slot.placeholder ?? "Αναζήτηση..."}
                className="cms-input"
              />
            </label>
          );
        }
        // select slot
        return (
          <label key={slot.key} className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
              {slot.label}
            </span>
            <select
              name={slot.key}
              defaultValue={values[slot.key] ?? ""}
              className="cms-input min-w-[140px]"
            >
              <option value="">{slot.anyLabel ?? "— όλα —"}</option>
              {slot.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        );
      })}

      <div className="flex items-center gap-2 self-end">
        <button type="submit" className="btn btn-secondary btn-md">
          Εφαρμογή
        </button>
        {hasAnyActive && (
          <Link
            href={clearHref}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            Καθαρισμός
          </Link>
        )}
      </div>
    </form>
  );
}
