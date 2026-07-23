/**
 * Shared chrome elements for /admin/customers — imported by page.tsx
 * and loading.tsx so the navigation gap and data gap show identical
 * structure.
 */
import "server-only";
import type { CustomerSource } from "@/types/customer";

export const PAGE_SIZE = 30;

export const SOURCES: { value: CustomerSource; label: string }[] = [
  { value: "eshop_signup", label: "Eshop" },
  { value: "admin_manual", label: "Από admin" },
  { value: "phone", label: "Τηλεφωνική" },
  { value: "in_store", label: "Σε κατάστημα" },
];

export const CUSTOMERS_TABLE_COLUMNS = [
  { label: "Όνομα" },
  { label: "Email" },
  { label: "Τηλέφωνο" },
  { label: "Πηγή" },
  { label: "Λογαριασμός" },
  { label: "Παραγγελίες", thClassName: "text-center" },
  { label: "Τελευταία" },
  { label: "" },
];

export function isSource(s: string | undefined): s is CustomerSource {
  return (
    s === "eshop_signup" ||
    s === "admin_manual" ||
    s === "phone" ||
    s === "in_store"
  );
}

/**
 * Filter form — pure HTML, no data dependency. Same shape rendered
 * by loading.tsx (with empty defaults) and page.tsx (with URL-derived
 * defaults).
 */
export function CustomersFilterForm({
  q,
  source,
  authFilter,
  showEmpty,
}: {
  q?: string;
  source?: string;
  authFilter?: string;
  showEmpty?: boolean;
}) {
  return (
    <form className="flex flex-wrap items-center gap-2 mb-4 text-sm">
      <input
        type="search"
        name="q"
        defaultValue={q ?? ""}
        placeholder="Αναζήτηση email, όνομα, τηλέφωνο..."
        className="cms-input flex-1 min-w-[260px]"
      />
      <select
        name="source"
        defaultValue={source ?? ""}
        className="cms-input w-auto"
      >
        <option value="">Όλες οι πηγές</option>
        {SOURCES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <select
        name="auth"
        defaultValue={authFilter ?? "all"}
        className="cms-input w-auto"
      >
        <option value="all">Όλοι</option>
        <option value="with">Με λογαριασμό</option>
        <option value="without">Offline μόνο</option>
      </select>
      <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          name="show_empty"
          value="yes"
          defaultChecked={showEmpty ?? false}
        />
        <span>Κενές εγγραφές</span>
      </label>
      <button type="submit" className="btn btn-secondary btn-md">
        Εφαρμογή
      </button>
    </form>
  );
}
