import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import { StaticTableSkeleton } from "@/components/admin/common/static-chrome";
import { formatCurrency } from "@/lib/multi-currency/formatCurrency";
import type { Order } from "@/types/order-history";
import {
  FULFILLMENT_STATUSES,
  PAYMENT_STATUSES,
  type FulfillmentStatus,
  type PaymentStatus,
  paymentMethodLabel,
  deliveryMethodLabel,
  CARRIER_LABELS,
  type CarrierValue,
} from "@/config/storefront";
import { requirePermission } from "@/lib/rbac";
import {
  ORDERS_TABLE_COLUMNS,
  OrdersFilterForm,
  PAGE_SIZE,
} from "./_chrome";

export const metadata = { title: "Παραγγελίες — Admin" };
export const dynamic = "force-dynamic";

/**
 * Orders page following the "chrome first, data streams in" pattern.
 *
 * The page handler runs only the permission check + a synchronous read
 * of searchParams, then returns chrome immediately: page header, the
 * filter form (defaulted to URL values), and a Suspense boundary for
 * the data-bearing table. The orders query + carrier lookup happen
 * inside <OrdersTableData />.
 *
 * The sibling loading.tsx renders the SAME chrome (without filter
 * values, since it can't see searchParams) + an identical skeleton,
 * so the navigation gap and the data gap show the same structure.
 */
export default async function AdminOrdersPage(props: {
  searchParams: Promise<{
    q?: string;
    fulfillment?: string;
    payment?: string;
    page?: string;
  }>;
}) {
  await requirePermission("manage:orders");
  const searchParams = await props.searchParams;
  const q = searchParams.q?.trim() ?? "";
  const fulfillment = searchParams.fulfillment ?? "all";
  const payment = searchParams.payment ?? "all";
  const page = Math.max(1, Number(searchParams.page ?? 1));

  return (
    <>
      <PageHeader
        title="Παραγγελίες"
        description="Φιλτράρετε ανά κατάσταση πληρωμής ή ροή αποστολής."
        actions={
          <Link href="/admin/orders/new" className="btn btn-primary btn-md">
            <span className="text-base leading-none">+</span> Νέα παραγγελία
          </Link>
        }
      />

      <OrdersFilterForm q={q} fulfillment={fulfillment} payment={payment} />

      <Suspense
        fallback={
          <StaticTableSkeleton
            columns={ORDERS_TABLE_COLUMNS}
            rowCount={10}
          />
        }
      >
        <OrdersTableData
          q={q}
          fulfillment={fulfillment}
          payment={payment}
          page={page}
        />
      </Suspense>
    </>
  );
}

/**
 * Async data component — does the actual query work + renders the
 * table. Suspended by the page so the chrome renders immediately
 * while this resolves.
 */
async function OrdersTableData({
  q,
  fulfillment,
  payment,
  page,
}: {
  q: string;
  fulfillment: string;
  payment: string;
  page: number;
}) {
  const supabase = await createClient();
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from("orders")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (q) query = query.ilike("order_number", `%${q.replace(/[%_]/g, "\\$&")}%`);
  if (
    fulfillment !== "all" &&
    FULFILLMENT_STATUSES.includes(fulfillment as FulfillmentStatus)
  ) {
    query = query.eq("fulfillment_status", fulfillment);
  }
  if (payment !== "all" && PAYMENT_STATUSES.includes(payment as PaymentStatus)) {
    query = query.eq("payment_status", payment);
  }

  const [carriersRes, ordersRes] = await Promise.all([
    supabase.from("delivery_carriers").select("slug, tracking_url_template"),
    query,
  ]);
  const trackingTemplateBySlug = new Map<string, string | null>(
    (
      (carriersRes.data ?? []) as Array<{
        slug: string;
        tracking_url_template: string | null;
      }>
    ).map((c) => [c.slug, c.tracking_url_template])
  );
  const { data, count } = ordersRes;
  const orders = (data ?? []) as Order[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function resolveTrackingUrl(o: Order): string | null {
    if (!o.tracking_number) return null;
    if (o.tracking_url_override) return o.tracking_url_override;
    const tmpl = o.carrier ? trackingTemplateBySlug.get(o.carrier) : null;
    if (!tmpl) return null;
    return tmpl.replace(
      "{tracking_number}",
      encodeURIComponent(o.tracking_number)
    );
  }

  const queryString = (override: Partial<Record<string, string | number>>) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (fulfillment !== "all") params.set("fulfillment", fulfillment);
    if (payment !== "all") params.set("payment", payment);
    for (const [k, v] of Object.entries(override)) params.set(k, String(v));
    return params.toString();
  };

  if (orders.length === 0) {
    return <div className="cms-empty">Δεν υπάρχουν παραγγελίες.</div>;
  }

  return (
    <>
      <div className="cms-table-wrap">
        <table className="cms-table">
          <thead>
            <tr>
              {ORDERS_TABLE_COLUMNS.map((c, i) => (
                <th key={i} className={c.thClassName}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="content-reveal">
            {orders.map((o) => {
              const trackingUrl = resolveTrackingUrl(o);
              const customerName =
                o.customer_name_at_order?.trim() || "(χωρίς όνομα)";
              const customerPhone = o.customer_phone_at_order ?? null;
              const carrierLabel = o.carrier
                ? CARRIER_LABELS[o.carrier as CarrierValue] ?? o.carrier
                : null;
              return (
                <tr key={o.id}>
                  <td className="text-left">
                    <p className="font-mono text-xs">{o.order_number}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {new Date(o.created_at).toLocaleDateString("el-GR")}
                    </p>
                  </td>
                  <td>
                    <p className="text-sm">{customerName}</p>
                    {customerPhone && (
                      <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                        {customerPhone}
                      </p>
                    )}
                  </td>
                  <td>
                    <p className="text-xs">{paymentMethodLabel(o.payment_method)}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {o.payment_status}
                    </p>
                  </td>
                  <td>
                    <p className="text-xs">{deliveryMethodLabel(o.delivery_method)}</p>
                    {carrierLabel && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {carrierLabel}
                      </p>
                    )}
                  </td>
                  <td>
                    {trackingUrl ? (
                      <a
                        href={trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs underline"
                      >
                        Tracking
                      </a>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    )}
                  </td>
                  <td>
                    <span className="text-xs">{o.fulfillment_status}</span>
                  </td>
                  <td className="text-center">
                    <span className="text-xs font-medium">
                      {formatCurrency(Number(o.total), o.currency)}
                    </span>
                  </td>
                  <td className="text-right">
                    <Link
                      href={`/admin/orders/${o.id}`}
                      className="btn btn-secondary btn-sm"
                    >
                      Λεπτομέρειες
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link
              href={`?${queryString({ page: page - 1 })}`}
              className="btn btn-secondary btn-sm"
            >
              ← Προηγούμενη
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            Σελίδα {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={`?${queryString({ page: page + 1 })}`}
              className="btn btn-secondary btn-sm"
            >
              Επόμενη →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}
