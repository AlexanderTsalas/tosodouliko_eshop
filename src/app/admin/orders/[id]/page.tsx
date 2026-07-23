import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OrderStatusSelect from "@/components/admin/orders/OrderStatusSelect";
import OrderRefundButton from "@/components/admin/orders/OrderRefundButton";
import OrderStatusTimelineLive from "@/components/admin/orders/OrderStatusTimelineLive";
import OrderTrackingEditor from "@/components/admin/orders/OrderTrackingEditor";
import OrderVoucherActions from "@/components/admin/orders/OrderVoucherActions";
import DeleteOrderButton from "@/components/admin/orders/DeleteOrderButton";
import AddressDisplay from "@/components/features/address-book/AddressDisplay";
import {
  ShoppingBag,
  Truck,
  Tag,
  Users,
  ClipboardList,
  Info,
} from "@/components/admin/common/icons";
import {
  paymentMethodLabel,
  deliveryMethodLabel,
  CARRIER_LABELS,
  type CarrierValue,
} from "@/config/storefront";
import type { TimelinePresetName } from "@/config/status-timelines";
import { loadOrderCustomFields } from "@/lib/custom-fields/loadOrderCustomFields";
import OrderItemCustomFields from "@/components/admin/orders/OrderItemCustomFields";
import { formatCurrency } from "@/lib/multi-currency/formatCurrency";
import { getCapabilities } from "@/lib/courier/getCapabilities";
import type { Order, OrderItem } from "@/types/order-history";
import type { FeeBreakdownEntry } from "@/types/fee";
import type { PaymentIntent } from "@/types/payment-gateway";
import type { Shipment } from "@/types/courier-integration";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Παραγγελία — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminOrderDetailPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  await requirePermission("manage:orders");
  const params = await props.params;
  const supabase = await createClient();

  const [
    orderRes,
    itemsRes,
    paymentsRes,
    shipmentsRes,
    customFieldsByOrderItem,
  ] = await Promise.all([
    supabase
      .from("orders")
      .select("*, customers(id, email, phone, first_name, last_name, auth_user_id, source)")
      .eq("id", params.id)
      .maybeSingle(),
    supabase.from("order_items").select("*").eq("order_id", params.id),
    supabase
      .from("payment_intents")
      .select("*")
      .eq("order_id", params.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("shipments")
      .select("*")
      .eq("order_id", params.id)
      .order("created_at", { ascending: false }),
    // Phase 8h: load custom field rows per order_item so the line
    // cards can render the customer's gift-message / engraving / etc.
    loadOrderCustomFields(params.id),
  ]);

  if (!orderRes.data) notFound();

  // Resolve the carrier row for the tracking-URL preview. carrier_slug
  // supersedes the legacy carrier enum; fall back when only the
  // legacy column is populated on older orders.
  const orderCarrierSlug =
    (orderRes.data as { carrier_slug: string | null; carrier: string | null }).carrier_slug ??
    (orderRes.data as { carrier: string | null }).carrier;

  // Carrier row + capability set fetched in parallel — both depend
  // only on the carrier slug, neither depends on the other. Saves one
  // round-trip on every order detail render.
  const [carrierRowRes, carrierCapabilities] = await Promise.all([
    orderCarrierSlug
      ? supabase
          .from("delivery_carriers")
          .select("display_name, tracking_url_template, timeline_preset")
          .eq("slug", orderCarrierSlug)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    orderCarrierSlug ? getCapabilities(orderCarrierSlug) : Promise.resolve(new Set<string>()),
  ]);
  const carrierRow = carrierRowRes.data as {
    display_name: string;
    tracking_url_template: string | null;
    timeline_preset: string | null;
  } | null;
  type OrderWithCustomer = Order & {
    customers:
      | {
          id: string;
          email: string | null;
          phone: string | null;
          first_name: string | null;
          last_name: string | null;
          auth_user_id: string | null;
          source: string;
        }
      | null;
  };
  const orderRaw = orderRes.data as OrderWithCustomer;
  const order = orderRaw;
  const customer = Array.isArray(orderRaw.customers)
    ? (orderRaw.customers as OrderWithCustomer["customers"][])[0]
    : orderRaw.customers;
  const items = (itemsRes.data ?? []) as OrderItem[];
  const payments = (paymentsRes.data ?? []) as PaymentIntent[];
  const shipments = (shipmentsRes.data ?? []) as Shipment[];

  // Validate timeline_preset narrows to the typed union (status-timelines.ts
  // TimelinePresetName). Unknown values fall through to null so
  // getTimelineForCarrier falls back to the generic timeline.
  const PRESET_VALUES: ReadonlySet<TimelinePresetName> = new Set([
    "generic",
    "acs_style",
    "geniki_style",
    "boxnow_style",
  ]);
  const timelinePreset: TimelinePresetName | null =
    carrierRow?.timeline_preset && PRESET_VALUES.has(carrierRow.timeline_preset as TimelinePresetName)
      ? (carrierRow.timeline_preset as TimelinePresetName)
      : null;

  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-6">
        <div className="min-w-0">
      <Link href="/admin/orders" className="btn btn-secondary btn-sm mb-4">
        ← Πίσω στις παραγγελίες
      </Link>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">{order.order_number}</h1>
        <p className="text-sm text-muted-foreground">
          {new Date(order.created_at).toLocaleString("el-GR")}
        </p>
      </header>

      {/* Stat tiles — 3-up compact strip: payment method, delivery,
          fulfillment-status (editable). Payment status now lives
          inside the Πληρωμές section card where it's contextually
          surrounded by Stripe activity / refund affordances —
          duplicating it up here was visual noise. */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-5">
        <StatTile
          label="Μέθοδος πληρωμής"
          value={paymentMethodLabel(order.payment_method)}
        />
        <StatTile
          label="Τρόπος παράδοσης"
          value={deliveryMethodLabel(order.delivery_method)}
          hint={
            order.carrier
              ? (CARRIER_LABELS[order.carrier as CarrierValue] ?? order.carrier)
              : undefined
          }
        />
        <StatTile
          label="Κατάσταση ροής"
          value={
            <OrderStatusSelect
              kind="fulfillment"
              orderId={order.id}
              currentStatus={order.fulfillment_status}
              carrierSlug={orderCarrierSlug}
              timelinePreset={timelinePreset}
              orderUpdatedAt={order.updated_at}
            />
          }
        />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start mb-5">
        {/* ═══ COLUMN 1: Customer + Items + Totals ═══ */}
        <div className="space-y-5">
          <section className="cms-card-section space-y-4">
            <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
              <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
                <Users className="w-4 h-4" />
                Πελάτης
              </h2>
              <p className="text-sm text-foreground/70 mt-1.5">
                Πηγή παραγγελίας: <span className="cms-badge cms-badge-muted">{order.source}</span>
              </p>
            </header>
            <div>
              <p className="text-base font-medium">
                {customer
                  ? [customer.first_name, customer.last_name]
                      .filter(Boolean)
                      .join(" ") ||
                    customer.email ||
                    "(χωρίς όνομα)"
                  : order.customer_name_at_order ?? "—"}
              </p>
              {(customer?.email ?? order.customer_email_at_order) && (
                <p className="text-sm text-muted-foreground mt-1">
                  {customer?.email ?? order.customer_email_at_order}
                </p>
              )}
              {(customer?.phone ?? order.customer_phone_at_order) && (
                <p className="text-sm text-muted-foreground">
                  {customer?.phone ?? order.customer_phone_at_order}
                </p>
              )}
              {customer && !customer.auth_user_id && (
                <p className="text-xs text-muted-foreground mt-2 italic">
                  {customer.source === "phone"
                    ? "Τηλεφωνική παραγγελία"
                    : customer.source === "in_store"
                      ? "Παραγγελία σε κατάστημα"
                      : "Πελάτης χωρίς λογαριασμό"}
                </p>
              )}
              {customer && (
                <Link
                  href={`/admin/customers/${customer.id}`}
                  className="btn btn-secondary btn-sm mt-3"
                >
                  Καρτέλα πελάτη →
                </Link>
              )}
            </div>
          </section>

          <section className="cms-card-section space-y-4">
            <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
                <ShoppingBag className="w-4 h-4" />
                Προϊόντα
              </h2>
              <span className="text-xs text-muted-foreground">
                {items.length}{" "}
                {items.length === 1 ? "γραμμή" : "γραμμές"} ·{" "}
                {items.reduce((s, it) => s + it.quantity, 0)} τεμ.
              </span>
            </header>

            {/* Items as ROW CARDS instead of a wide table — the section
                sits inside a half-width column on lg+, so a 5-column
                table cramps every cell and forces long product names
                + SKUs to break across multiple lines. The card layout
                gives the product name room to breathe on its own line,
                puts the SKU directly beneath it, and right-aligns the
                qty / price / total trio in a fixed-width column. */}
            <ul className="rounded-lg overflow-hidden bg-background border border-foreground/10 shadow-[0_1px_2px_rgba(0,0,0,0.04)] divide-y divide-foreground/10">
              {items.map((it) => {
                const customFields =
                  customFieldsByOrderItem[it.id] ?? [];
                const itemAny = it as unknown as {
                  modifier_total: number | string | null;
                };
                const modifierPerUnit = Number(itemAny.modifier_total) || 0;
                return (
                  <li
                    key={it.id}
                    className="px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium leading-tight break-words">
                          {it.product_name}
                        </p>
                        {it.sku && (
                          <p className="text-[11px] font-mono text-muted-foreground mt-1 break-all">
                            {it.sku}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0 font-mono tabular-nums text-sm whitespace-nowrap">
                        <p className="text-muted-foreground">
                          {it.quantity} ×{" "}
                          {formatCurrency(
                            Number(it.unit_price),
                            order.currency
                          )}
                          {modifierPerUnit > 0 && (
                            <span className="text-emerald-700">
                              {" "}
                              + {formatCurrency(modifierPerUnit, order.currency)}
                            </span>
                          )}
                        </p>
                        <p className="font-semibold text-base">
                          {formatCurrency(Number(it.total), order.currency)}
                        </p>
                      </div>
                    </div>
                    <OrderItemCustomFields
                      entries={customFields}
                      fulfillment_status={order.fulfillment_status}
                      currency={order.currency}
                    />
                  </li>
                );
              })}
            </ul>

            {/* Totals — wider than before (max-w-md, was max-w-sm) +
                horizontal separators between groups so the eye can
                scan the breakdown faster. Σύνολο gets its own row
                with bolder typography on a top divider. */}
            <dl className="text-sm space-y-1 max-w-md ml-auto">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Υποσύνολο</dt>
                <dd className="font-mono tabular-nums">
                  {formatCurrency(Number(order.subtotal), order.currency)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Έκπτωση</dt>
                <dd className="font-mono tabular-nums">
                  −{formatCurrency(Number(order.discount_amount), order.currency)}
                </dd>
              </div>
              {(order.fees_breakdown ?? []).length > 0 ? (
                (order.fees_breakdown ?? [])
                  .slice()
                  .sort((a, b) => a.display_order - b.display_order)
                  .map((fee) => (
                    <FeeBreakdownLine
                      key={fee.category_slug}
                      fee={fee}
                      currency={order.currency}
                    />
                  ))
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Μεταφορικά</dt>
                  <dd className="font-mono tabular-nums">
                    {formatCurrency(Number(order.shipping_amount), order.currency)}
                  </dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">ΦΠΑ</dt>
                <dd className="font-mono tabular-nums">
                  {formatCurrency(Number(order.tax_amount), order.currency)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 pt-2 mt-1 border-t border-foreground/15">
                <dt className="font-semibold text-base">Σύνολο</dt>
                <dd className="font-mono tabular-nums font-semibold text-base">
                  {formatCurrency(Number(order.total), order.currency)}
                </dd>
              </div>
            </dl>
          </section>
        </div>

        {/* ═══ COLUMN 2: Addresses + Payments + Tracking + Shipments ═══ */}
        <div className="space-y-5">
          <section className="cms-card-section space-y-4">
            <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
              <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
                <Info className="w-4 h-4" />
                Διευθύνσεις
              </h2>
            </header>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                  Αποστολή
                </p>
                <AddressDisplay
                  address={order.shipping_address}
                  fallback="Δεν δηλώθηκε διεύθυνση αποστολής."
                />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                  Χρέωση
                </p>
                <AddressDisplay
                  address={order.billing_address}
                  fallback="Δεν δηλώθηκε διεύθυνση χρέωσης."
                />
              </div>
            </div>
          </section>

          <section className="cms-card-section space-y-4">
            <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
              <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
                <Tag className="w-4 h-4" />
                Πληρωμές
              </h2>
            </header>

            {/* Payment status — moved here from the top stat strip.
                Contextually it belongs with the Stripe payment log and
                the refund button; the duplicate stat tile at top was
                noise. For COD orders this is also how the admin marks
                the order as paid after the customer pre-deposits the
                amount (a valid real-world workflow). */}
            <div className="rounded-md border border-foreground/15 bg-muted/30 px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground leading-tight">
                  Κατάσταση πληρωμής
                </p>
                <div className="mt-1">
                  <OrderStatusSelect
                    kind="payment"
                    orderId={order.id}
                    currentStatus={order.payment_status}
                    paymentMethod={order.payment_method}
                    orderUpdatedAt={order.updated_at}
                  />
                </div>
              </div>
              <OrderRefundButton
                orderId={order.id}
                paymentStatus={order.payment_status}
                orderUpdatedAt={order.updated_at}
              />
            </div>

            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                {order.payment_method === "stripe"
                  ? "Καμία καταγραφή Stripe ακόμη."
                  : "Δεν εφαρμόζεται — η παραγγελία πληρώθηκε εκτός Stripe. Δηλώστε την κατάσταση παραπάνω."}
              </p>
            ) : (
              <ul className="divide-y divide-foreground/10 text-sm">
                {payments.map((p) => (
                  <li key={p.id} className="py-2 flex justify-between gap-2">
                    <span className="font-mono text-xs truncate">
                      {p.stripe_payment_intent_id}
                    </span>
                    <span className="font-mono tabular-nums shrink-0">
                      {p.status} ·{" "}
                      {formatCurrency(p.amount / 100, p.currency.toUpperCase())}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="cms-card-section space-y-4">
            <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
              <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
                <ClipboardList className="w-4 h-4" />
                Αποστολές
              </h2>
            </header>
            {shipments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Δεν έχει δημιουργηθεί αποστολή.
              </p>
            ) : (
              <ul className="divide-y divide-foreground/10 text-sm">
                {shipments.map((s) => (
                  <li key={s.id} className="py-2 flex justify-between gap-2">
                    <span>
                      {s.courier}{" "}
                      {s.tracking_number ? `· ${s.tracking_number}` : ""}
                    </span>
                    <span className="cms-badge cms-badge-muted">{s.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* Παρακολούθηση αποστολής — moved to the bottom of the page
          (above the danger zone) so it sits as a deliberate
          full-width step the admin performs at fulfillment time,
          rather than competing for attention in the right rail. */}
      <section className="cms-card-section space-y-4 mb-5">
        <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
          <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
            <Truck className="w-4 h-4" />
            Παρακολούθηση αποστολής
          </h2>
          <p className="text-sm text-foreground/70 mt-1.5">
            Δημιουργία voucher, παρακολούθηση και χειροκίνητη καταχώρηση
            tracking number.
          </p>
        </header>
        {order.delivery_method === "store_pickup" ? (
          <p className="text-sm text-muted-foreground">
            Δεν εφαρμόζεται — η παραγγελία παραλαμβάνεται από το κατάστημα.
          </p>
        ) : (
          <>
            <OrderTrackingEditor
              orderId={order.id}
              carrierDisplayName={carrierRow?.display_name ?? null}
              carrierTemplate={carrierRow?.tracking_url_template ?? null}
              initialTrackingNumber={order.tracking_number}
              initialTrackingUrlOverride={order.tracking_url_override}
              orderUpdatedAt={order.updated_at}
            />
            <OrderVoucherActions
              orderId={order.id}
              trackingNumber={order.tracking_number}
              canCreate={carrierCapabilities.has("create_voucher")}
              canCancel={carrierCapabilities.has("cancel_voucher")}
              canRefreshTracking={carrierCapabilities.has("fetch_tracking")}
              carrierDisplayName={carrierRow?.display_name ?? null}
            />
          </>
        )}
      </section>

      <section className="cms-card-section border-destructive/30">
        <header className="pb-3 -mt-1 mb-3 border-b border-destructive/30">
          <h2 className="text-base font-semibold uppercase tracking-wide text-destructive">
            Επικίνδυνη ζώνη
          </h2>
          <p className="text-sm text-foreground/70 mt-1.5">
            Διαγραφή παραγγελίας — δεν αναιρείται.
          </p>
        </header>
        <DeleteOrderButton
          orderId={order.id}
          orderNumber={order.order_number}
          paymentMethod={order.payment_method}
          paymentStatus={order.payment_status}
          fulfillmentStatus={order.fulfillment_status}
        />
      </section>
        </div>
        {/* Right rail — order status timeline. Sticky on xl+ so it stays
            visible as the operator scrolls through the main column. */}
        <aside className="xl:sticky xl:top-6 xl:self-start">
          <OrderStatusTimelineLive
            orderId={order.id}
            carrierSlug={orderCarrierSlug}
            timelinePreset={timelinePreset}
            fulfillmentStatus={order.fulfillment_status}
          />
        </aside>
      </div>
    </>
  );
}

/**
 * Read-only metric tile — same vocabulary as the product overview's
 * stat tiles. Supports an optional `extra` slot for an inline button
 * (e.g. refund) that sits below the value.
 */
function StatTile({
  label,
  value,
  hint,
  extra,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-foreground/10 bg-card px-3.5 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground leading-tight">
        {label}
      </p>
      <div className="mt-1 text-sm font-semibold tracking-tight leading-tight">
        {value}
      </div>
      {hint && (
        <p className="text-[10px] text-muted-foreground mt-1 leading-tight truncate">
          {hint}
        </p>
      )}
      {extra && <div className="mt-1">{extra}</div>}
    </div>
  );
}

function FeeBreakdownLine({
  fee,
  currency,
}: {
  fee: FeeBreakdownEntry;
  currency: string;
}) {
  const hasMismatch =
    fee.api_quote !== null && Math.abs(fee.api_quote - fee.charged) > 0.005;
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">
        {fee.label}
        {hasMismatch && (
          <span
            title={`Courier quote: ${formatCurrency(fee.api_quote ?? 0, currency)}`}
            className="ml-1 text-amber-600"
          >
            ⚠
          </span>
        )}
      </dt>
      <dd className="font-mono tabular-nums">
        {formatCurrency(Number(fee.charged), currency)}
      </dd>
    </div>
  );
}
