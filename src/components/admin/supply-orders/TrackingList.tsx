import Link from "next/link";
import OrderStatusActions from "@/components/admin/supply-orders/OrderStatusActions";
import type { Supplier, SupplyOrder, SupplyOrderStatus } from "@/types/suppliers";

export interface TrackingRow {
  order: SupplyOrder;
  supplier: Supplier;
  lineCount: number;
  totalCost: number;
  totalCurrency: string;
}

interface Props {
  /** Rows for the CURRENT page (after status filter + pagination slice). */
  rows: TrackingRow[];
  /** Active status filter, drives the highlighted tab. */
  filter: SupplyOrderStatus | "all";
  /** Per-status total counts across the whole result set (drive tab badges). */
  statusCounts: { all: number; placed: number; received: number; cancelled: number };
}

/**
 * Status pill styling in the restrained palette. Visual weight scales
 * with the user-relevance of the status — placed/received are the
 * "active" lifecycle states and get a solid bordered look; draft is
 * muted; cancelled gets a struck-through treatment via opacity.
 */
const STATUS_BADGE: Record<SupplyOrderStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "cms-badge cms-badge-muted" },
  placed: { label: "Placed", className: "cms-badge cms-badge-neutral" },
  received: {
    label: "Received",
    className: "cms-badge border-foreground bg-foreground text-background",
  },
  cancelled: { label: "Cancelled", className: "cms-badge cms-badge-muted line-through" },
};

const TAB_LABELS: Record<"all" | SupplyOrderStatus, string> = {
  all: "Όλες",
  draft: "Draft",
  placed: "Placed",
  received: "Received",
  cancelled: "Cancelled",
};

export default function TrackingList({ rows, filter, statusCounts }: Props) {
  return (
    <div className="space-y-4">
      {/* Status filter tabs — match the CMS-wide tab vocabulary used on
          the couriers page (uppercase, count pill, underline on active). */}
      <nav
        className="border-b border-foreground/10 flex flex-wrap gap-1"
        aria-label="Φίλτρο κατάστασης"
      >
        {(["all", "placed", "received", "cancelled"] as const).map((f) => {
          const isActive = filter === f;
          return (
            <Link
              key={f}
              href={`/admin/supply-orders?view=tracking&filter=${f}`}
              className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-sm border-b-2 -mb-px transition-colors ${
                isActive
                  ? "border-foreground text-foreground font-semibold"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-foreground/30"
              }`}
              aria-current={isActive ? "page" : undefined}
            >
              {TAB_LABELS[f]}
              <span
                className={`rounded-full px-1.5 py-0 min-w-[18px] text-center text-[11px] font-medium tabular-nums ${
                  isActive
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {statusCounts[f]}
              </span>
            </Link>
          );
        })}
      </nav>

      {rows.length === 0 ? (
        <div className="cms-empty">
          Δεν υπάρχουν παραγγελίες σε αυτή την κατηγορία.
        </div>
      ) : (
        <div className="cms-table-wrap">
          <table className="cms-table">
            <thead>
              <tr>
                <th>Προμηθευτής</th>
                <th>Κατάσταση</th>
                <th className="text-center">Γραμμές</th>
                <th className="text-center">Σύνολο</th>
                <th>Καταχωρήθηκε</th>
                <th>Ενέργειες</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ order, supplier, lineCount, totalCost, totalCurrency }) => {
                const badge = STATUS_BADGE[order.status];
                return (
                  <tr key={order.id}>
                    <td className="font-medium">
                      <Link
                        href={`/admin/suppliers/${supplier.id}`}
                        className="hover:underline"
                      >
                        {supplier.name}
                      </Link>
                    </td>
                    <td>
                      <span className={badge.className}>{badge.label}</span>
                    </td>
                    <td className="text-center tabular-nums">{lineCount}</td>
                    <td className="text-center tabular-nums font-mono">
                      {totalCost.toFixed(2)} {totalCurrency}
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {order.placed_at
                        ? new Date(order.placed_at).toLocaleString("el-GR")
                        : new Date(order.created_at).toLocaleString("el-GR")}
                    </td>
                    <td>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/admin/supply-orders/${order.id}`}
                          className="btn btn-secondary btn-sm"
                        >
                          Άνοιγμα
                        </Link>
                        <OrderStatusActions
                          orderId={order.id}
                          status={order.status}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
