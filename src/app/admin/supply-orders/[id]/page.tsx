import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ReceiptWorkspace from "@/components/admin/supply-orders/ReceiptWorkspace";
import OrderStatusActions from "@/components/admin/supply-orders/OrderStatusActions";
import type { Supplier, SupplyOrder, SupplyOrderLine } from "@/types/suppliers";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Παραγγελία προμηθειών — Admin" };
export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  draft:     { label: "Draft",     className: "bg-muted text-muted-foreground" },
  placed:    { label: "Placed",    className: "bg-blue-100 text-blue-800" },
  received:  { label: "Received",  className: "bg-emerald-100 text-emerald-800" },
  cancelled: { label: "Cancelled", className: "bg-rose-100 text-rose-800" },
};

export default async function SupplyOrderDetailPage(
  props: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ action?: string }>;
  }
) {
  await requirePermission("manage:suppliers");
  const searchParams = await props.searchParams;
  const params = await props.params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("supply_orders")
    .select("*, suppliers(*), supply_order_lines(*)")
    .eq("id", params.id)
    .maybeSingle();

  if (!data) notFound();

  const raw = data as SupplyOrder & {
    suppliers: Supplier | Supplier[] | null;
    supply_order_lines: SupplyOrderLine[] | null;
  };
  const supplier = Array.isArray(raw.suppliers) ? raw.suppliers[0] : raw.suppliers;
  if (!supplier) notFound();
  const lines = (raw.supply_order_lines ?? []) as SupplyOrderLine[];
  const { suppliers: _s, supply_order_lines: _l, ...orderOnly } = raw;
  const order = orderOnly as SupplyOrder;

  const totalCost = lines.reduce(
    (acc, l) => acc + (Number(l.unit_cost) || 0) * l.ordered_qty,
    0
  );
  const currency = lines[0]?.unit_cost_currency ?? supplier.default_currency;

  const showReceiptWorkspace = searchParams.action === "receive" && order.status === "placed";

  return (
    <>
      <Link
        href="/admin/supply-orders?view=tracking"
        className="btn btn-secondary btn-sm mb-4"
      >
        ← Παρακολούθηση παραγγελιών
      </Link>
      <header className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold mt-1">
            Παραγγελία προς{" "}
            <Link href={`/admin/suppliers/${supplier.id}`} className="hover:underline">
              {supplier.name}
            </Link>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            <span className={`rounded px-2 py-0.5 mr-2 ${STATUS_BADGE[order.status].className}`}>
              {STATUS_BADGE[order.status].label}
            </span>
            {order.placed_at && (
              <>Καταχώρηση: {new Date(order.placed_at).toLocaleString("el-GR")}</>
            )}
            {order.received_at && (
              <span className="ml-2">
                Παραλαβή: {new Date(order.received_at).toLocaleString("el-GR")}
              </span>
            )}
          </p>
        </div>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-4 max-w-2xl text-sm">
        <div className="border rounded p-3">
          <h3 className="font-semibold text-xs mb-1">Στοιχεία προμηθευτή</h3>
          {supplier.primary_email && (
            <p>📧 <a href={`mailto:${supplier.primary_email}`} className="hover:underline">{supplier.primary_email}</a></p>
          )}
          {supplier.primary_phone && (
            <p>📞 <a href={`tel:${supplier.primary_phone}`} className="hover:underline">{supplier.primary_phone}</a></p>
          )}
          {(supplier.street || supplier.city) && (
            <p className="text-xs text-muted-foreground mt-1">
              {[supplier.street, supplier.city, supplier.postal_code, supplier.country_code]
                .filter(Boolean)
                .join(", ")}
            </p>
          )}
        </div>
        <div className="border rounded p-3">
          <h3 className="font-semibold text-xs mb-1">Σύνοψη</h3>
          <p>Γραμμές: <span className="font-mono">{lines.length}</span></p>
          <p>Σύνολο: <span className="font-mono">{totalCost.toFixed(2)} {currency}</span></p>
          {order.receipt_file_storage_key && (
            <p className="text-xs text-muted-foreground mt-1">
              📎 Αρχείο παραλαβής αρχειοθετημένο
            </p>
          )}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="font-semibold text-sm mb-2">Γραμμές παραγγελίας</h2>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1">Προϊόν</th>
              <th className="py-1 w-28">SKU προμηθευτή</th>
              <th className="py-1 w-20">Παραγγέλθηκαν</th>
              <th className="py-1 w-20">Παρελήφθησαν</th>
              <th className="py-1 w-28">Κόστος μον.</th>
            </tr>
          </thead>
          <tbody className="content-reveal">
            {lines.map((l) => (
              <tr key={l.id} className="border-b">
                <td className="py-1">
                  <p>{l.variant_label ?? l.business_sku_at_draft}</p>
                  <p className="text-muted-foreground font-mono">{l.business_sku_at_draft}</p>
                </td>
                <td className="py-1 font-mono">{l.supplier_sku_at_draft ?? "—"}</td>
                <td className="py-1 font-mono">{l.ordered_qty}</td>
                <td className="py-1 font-mono">
                  {l.received_qty !== null ? (
                    <span className={l.received_qty < l.ordered_qty ? "text-amber-600" : ""}>
                      {l.received_qty}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-1 font-mono">
                  {l.received_unit_cost !== null
                    ? `${Number(l.received_unit_cost).toFixed(2)} ${l.unit_cost_currency ?? ""}`
                    : l.unit_cost !== null
                    ? `${Number(l.unit_cost).toFixed(2)} ${l.unit_cost_currency ?? ""}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {order.notes && (
        <section className="mb-6 text-xs text-muted-foreground">
          <strong>Σημειώσεις:</strong> {order.notes}
        </section>
      )}

      {/* Actions / Receipt workspace */}
      <section className="border-t pt-4">
        {showReceiptWorkspace ? (
          <ReceiptWorkspace order={order} supplier={supplier} lines={lines} />
        ) : (
          <div className="space-y-3">
            <OrderStatusActions orderId={order.id} status={order.status} />
            {order.status === "placed" && (
              <Link
                href={`/admin/supply-orders/${order.id}?action=receive`}
                className="inline-block rounded bg-primary text-primary-foreground px-4 py-2 text-sm"
              >
                Παραλαβή
              </Link>
            )}
          </div>
        )}
      </section>
    </>
  );
}
