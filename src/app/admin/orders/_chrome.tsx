/**
 * Shared chrome elements for /admin/orders — imported by both page.tsx
 * and loading.tsx so the navigation gap and data gap show identical
 * structure. The underscore prefix marks this as a private route-
 * segment file (not a Next.js routing convention, just a project
 * convention to flag "internal to this route segment").
 */
import "server-only";
import { FULFILLMENT_STATUSES, PAYMENT_STATUSES } from "@/config/storefront";

export const PAGE_SIZE = 30;

/** Column spec shared between live table render + static chrome skeleton. */
export const ORDERS_TABLE_COLUMNS = [
  { label: "Παραγγελία" },
  { label: "Πελάτης" },
  { label: "Πληρωμή" },
  { label: "Παράδοση" },
  { label: "Voucher" },
  { label: "Ροή" },
  { label: "Σύνολο", thClassName: "text-center" },
  { label: "" },
];

/**
 * Filter form — pure HTML, no data dependency. Renders with empty
 * defaults from loading.tsx (which can't access searchParams) and
 * with URL-derived defaults from the page handler. The visual swap
 * between empty defaults → URL values is invisible because both
 * renders use the same DOM and only the input values differ.
 */
export function OrdersFilterForm({
  q,
  fulfillment,
  payment,
}: {
  q?: string;
  fulfillment?: string;
  payment?: string;
}) {
  return (
    <form className="flex flex-wrap items-center gap-2 mb-4 text-sm">
      <input
        type="search"
        name="q"
        defaultValue={q ?? ""}
        placeholder="Αναζήτηση order_number..."
        className="cms-input flex-1 min-w-[200px]"
      />
      <select
        name="fulfillment"
        defaultValue={fulfillment ?? "all"}
        className="cms-input w-auto"
      >
        <option value="all">Όλες οι ροές</option>
        {FULFILLMENT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select
        name="payment"
        defaultValue={payment ?? "all"}
        className="cms-input w-auto"
      >
        <option value="all">Όλες οι πληρωμές</option>
        {PAYMENT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <button type="submit" className="btn btn-secondary btn-md">
        Εφαρμογή
      </button>
    </form>
  );
}
