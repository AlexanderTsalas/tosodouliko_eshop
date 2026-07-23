import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/multi-currency/formatCurrency";
import SaveInfoPrompt from "@/components/features/checkout/SaveInfoPrompt";
import type { Order, OrderItem } from "@/types/order-history";
import { strings } from "@/config/strings";

export const metadata = { title: strings.checkoutSuccess.pageTitle };
export const dynamic = "force-dynamic";

import { PAYMENT_INSTRUCTIONS } from "@/config/storefront";

export default async function CheckoutSuccessPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = await props.params;
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth/signin");

  const [{ data: custRow }, { data: orderRow }, { data: itemRows }] =
    await Promise.all([
      supabase
        .from("customers")
        .select("id")
        .eq("auth_user_id", authData.user.id)
        .maybeSingle(),
      supabase.from("orders").select("*").eq("id", params.id).maybeSingle(),
      supabase.from("order_items").select("*").eq("order_id", params.id),
    ]);
  const customerId = (custRow as { id: string } | null)?.id ?? null;
  if (!customerId) notFound();
  if (!orderRow) notFound();
  const order = orderRow as Order;
  if (order.customer_id !== customerId) notFound();
  const items = (itemRows ?? []) as OrderItem[];

  const isPaidStripe = order.payment_method === "stripe" && order.payment_status === "paid";
  const isPendingStripe = order.payment_method === "stripe" && order.payment_status === "pending";
  const instruction = PAYMENT_INSTRUCTIONS[order.payment_method] ?? "";

  return (
    <main className="container mx-auto px-4 py-12 max-w-2xl">
      <header className="text-center mb-8">
        <div
          className={`mx-auto rounded-full w-14 h-14 flex items-center justify-center text-2xl ${
            isPaidStripe || !isPendingStripe
              ? "bg-emerald-100 text-emerald-700"
              : "bg-amber-100 text-amber-700"
          }`}
        >
          {isPaidStripe ? "✓" : isPendingStripe ? "⏳" : "✓"}
        </div>
        <h1 className="font-serif text-3xl font-bold tracking-tight text-ink mt-3">
          {isPendingStripe ? "Παραγγελία σε εκκρεμότητα πληρωμής" : "Η παραγγελία σας καταχωρήθηκε!"}
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          Αριθμός παραγγελίας: <span className="font-mono font-medium text-ink">{order.order_number}</span>
        </p>
        <div className="w-28 h-0.5 bg-gradient-to-r from-transparent via-terracotta to-transparent mx-auto mt-4" />
      </header>

      {isPendingStripe && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 mb-6 text-sm text-amber-900">
          Η πληρωμή σας δεν έχει ολοκληρωθεί ακόμη.{" "}
          <Link href={`/checkout/payment/${order.id}`} className="font-medium underline">
            Συνεχίστε στην πληρωμή →
          </Link>
        </div>
      )}

      <section className="border rounded p-4 mb-6">
        <h2 className="font-medium mb-3">Σύνοψη</h2>
        <ul className="text-sm divide-y">
          {items.map((it) => (
            <li key={it.id} className="py-2 flex justify-between gap-3">
              <span>
                {it.product_name}
                <span className="text-muted-foreground"> × {it.quantity}</span>
                {it.variant_label && (
                  <span className="block text-xs text-muted-foreground">{it.variant_label}</span>
                )}
              </span>
              <span className="font-mono">
                {formatCurrency(Number(it.total), order.currency)}
              </span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 pt-3 border-t grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Υποσύνολο</dt>
          <dd className="text-right">{formatCurrency(Number(order.subtotal), order.currency)}</dd>
          <dt className="text-muted-foreground">Μεταφορικά</dt>
          <dd className="text-right">{formatCurrency(Number(order.shipping_amount), order.currency)}</dd>
          <dt className="text-muted-foreground">ΦΠΑ</dt>
          <dd className="text-right">{formatCurrency(Number(order.tax_amount), order.currency)}</dd>
          <dt className="font-medium">Σύνολο</dt>
          <dd className="text-right font-medium">
            {formatCurrency(Number(order.total), order.currency)}
          </dd>
        </dl>
      </section>

      <section className="border rounded p-4 mb-6 text-sm">
        <h2 className="font-medium mb-2">Πληρωμή</h2>
        <p>
          <span className="text-muted-foreground">Τρόπος:</span> {order.payment_method} ·{" "}
          <span className="text-muted-foreground">Κατάσταση:</span> {order.payment_status}
        </p>
        {instruction && <p className="text-muted-foreground mt-2">{instruction}</p>}
      </section>

      <section className="border rounded p-4 mb-6 text-sm">
        <h2 className="font-medium mb-2">Παράδοση</h2>
        <p>
          <span className="text-muted-foreground">Τρόπος:</span> {order.delivery_method}
          {order.carrier && ` · ${order.carrier}`}
        </p>
        <p className="text-muted-foreground mt-1">
          Κατάσταση: {order.fulfillment_status}. Θα σας ειδοποιήσουμε όταν αλλάξει.
        </p>
      </section>

      <div className="flex justify-center gap-5 text-sm">
        <Link href={`/orders/${order.id}`} className="text-terracotta hover:underline font-medium">
          Δείτε την παραγγελία
        </Link>
        <Link href="/" className="text-terracotta hover:underline font-medium">
          Συνέχεια στα προϊόντα
        </Link>
      </div>

      {/* Phase 9E + Phase 10: non-blocking signup CTA for guest customers. */}
      <SaveInfoPrompt orderId={order.id} />
    </main>
  );
}
