import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCheckoutSession } from "@/actions/payment/createCheckoutSession";
import { brand } from "@/config/brand";

export const metadata = { title: `Πληρωμή — ${brand.name}` };
export const dynamic = "force-dynamic";

/**
 * Payment redirect step.
 *
 * For Stripe orders, this page exists only to ensure a Checkout Session is
 * created (or reused if the customer landed back here from an expired session
 * URL) and then redirect to the Stripe-hosted checkout page. No UI rendered
 * on the happy path — just an immediate redirect.
 *
 * If the order isn't a Stripe order or is already paid, redirect to the
 * appropriate next page.
 */
export default async function PaymentPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = await props.params;
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth/signin?next=/checkout");

  const { data: custRow } = await supabase
    .from("customers")
    .select("id")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  const customerId = (custRow as { id: string } | null)?.id ?? null;
  if (!customerId) redirect("/auth/signin?next=/checkout");

  const { data: orderRow } = await supabase
    .from("orders")
    .select(
      "id, order_number, customer_id, payment_method, payment_status, fulfillment_status"
    )
    .eq("id", params.id)
    .maybeSingle();
  if (!orderRow) return notFoundShell();
  const order = orderRow as {
    id: string;
    order_number: string;
    customer_id: string;
    payment_method: "stripe" | "cod" | "cash_on_pickup" | "bank_transfer";
    payment_status: string;
    fulfillment_status: string;
  };
  if (order.customer_id !== customerId) return notFoundShell();

  if (order.payment_status === "paid") {
    redirect(`/checkout/success/${order.id}`);
  }
  if (order.payment_method !== "stripe") {
    redirect(`/checkout/success/${order.id}`);
  }

  // Reuse an existing unexpired session URL if one is on file (e.g., the
  // customer hit "back" on Stripe and re-landed here). Otherwise create one.
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("payment_intents")
    .select(
      "stripe_checkout_session_id, checkout_session_url, checkout_session_expires_at, status"
    )
    .eq("order_id", order.id)
    .in("status", ["session_pending"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const reusable = existing as
    | {
        checkout_session_url: string | null;
        checkout_session_expires_at: string | null;
      }
    | null;
  if (
    reusable?.checkout_session_url &&
    reusable.checkout_session_expires_at &&
    new Date(reusable.checkout_session_expires_at).getTime() > Date.now() + 60_000
  ) {
    // At least 60 seconds of headroom — enough for the customer to land on
    // Stripe before the session itself times out.
    redirect(reusable.checkout_session_url);
  }

  const r = await createCheckoutSession({ orderId: order.id });
  if (!r.success) {
    return errorShell(r.error);
  }
  redirect(r.data.url);
}

function notFoundShell() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-xl">
      <h1 className="font-serif text-3xl font-bold tracking-tight text-ink">Η παραγγελία δεν βρέθηκε</h1>
      <p className="text-sm text-muted-foreground mt-2">
        Ίσως ο σύνδεσμος είναι λάθος ή η παραγγελία δεν σας ανήκει.
      </p>
      <Link href="/" className="text-terracotta hover:underline text-sm mt-4 inline-block">
        ← Επιστροφή στο κατάστημα
      </Link>
    </main>
  );
}

function errorShell(message: string) {
  return (
    <main className="container mx-auto px-4 py-12 max-w-xl">
      <h1 className="font-serif text-3xl font-bold tracking-tight text-ink">Σφάλμα πληρωμής</h1>
      <p className="text-sm text-destructive mt-2">{message}</p>
      <p className="text-sm text-muted-foreground mt-4">
        Δοκιμάστε να ανανεώσετε τη σελίδα. Αν το πρόβλημα συνεχίζεται,
        επικοινωνήστε μαζί μας.
      </p>
    </main>
  );
}
