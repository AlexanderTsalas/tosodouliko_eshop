import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency } from "@/lib/multi-currency/formatCurrency";
import MockCheckoutSimulator from "@/components/features/checkout/MockCheckoutSimulator";
import { brand } from "@/config/brand";

export const metadata = { title: `Test Payment — ${brand.name}` };
export const dynamic = "force-dynamic";

/**
 * Mock checkout page. Stands in for Stripe's hosted checkout when the mock
 * provider is active. Looks up the session by id, shows the order summary,
 * and exposes "Simulate success / Simulate decline" buttons that POST to
 * the mock-payment webhook.
 *
 * Only reachable when the mock provider's createCheckoutSession returned a
 * URL pointing here (i.e., STRIPE_SECRET_KEY isn't configured or
 * PAYMENT_PROVIDER=mock is set).
 */
export default async function MockCheckoutPage(
  props: {
    params: Promise<{ session_id: string }>;
  }
) {
  const params = await props.params;
  const admin = createAdminClient();
  const { data: intentRow } = await admin
    .from("payment_intents")
    .select(
      "stripe_checkout_session_id, order_id, amount, currency, status, checkout_session_expires_at"
    )
    .eq("stripe_checkout_session_id", params.session_id)
    .maybeSingle();
  if (!intentRow) notFound();

  const intent = intentRow as {
    stripe_checkout_session_id: string;
    order_id: string;
    amount: number;
    currency: string;
    status: string;
    checkout_session_expires_at: string | null;
  };

  const { data: orderRow } = await admin
    .from("orders")
    .select("id, order_number, total, currency, payment_status")
    .eq("id", intent.order_id)
    .maybeSingle();
  if (!orderRow) notFound();
  const order = orderRow as {
    id: string;
    order_number: string;
    total: number | string;
    currency: string;
    payment_status: string;
  };

  const expired =
    intent.checkout_session_expires_at !== null &&
    new Date(intent.checkout_session_expires_at).getTime() < Date.now();
  const alreadyPaid = order.payment_status === "paid";

  return (
    <main className="container mx-auto px-4 py-8 max-w-xl">
      <header className="mb-6">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-ink">Πληρωμή</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Παραγγελία <span className="font-mono">{order.order_number}</span> — σύνολο{" "}
          <strong>{formatCurrency(Number(order.total), order.currency)}</strong>
        </p>
      </header>

      {alreadyPaid ? (
        <div className="rounded border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
          Η παραγγελία έχει ήδη πληρωθεί.{" "}
          <Link href={`/checkout/success/${order.id}`} className="underline font-medium">
            Συνέχεια →
          </Link>
        </div>
      ) : expired ? (
        <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Αυτή η συνεδρία πληρωμής έχει λήξει.{" "}
          <Link href={`/checkout/payment/${order.id}`} className="underline font-medium">
            Δοκιμάστε ξανά →
          </Link>
        </div>
      ) : (
        <MockCheckoutSimulator
          orderId={order.id}
          orderNumber={order.order_number}
          sessionId={intent.stripe_checkout_session_id}
          amount={Number(order.total)}
          currency={order.currency}
        />
      )}

      <p className="text-xs text-muted-foreground text-center mt-4">
        <Link href="/cart" className="text-terracotta hover:underline">
          ← Επιστροφή στο καλάθι (ακύρωση)
        </Link>
      </p>
    </main>
  );
}
