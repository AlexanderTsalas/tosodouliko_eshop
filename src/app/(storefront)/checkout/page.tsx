import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCart } from "@/lib/cart";
import { formatCurrency } from "@/lib/multi-currency/formatCurrency";
import CheckoutForm from "@/components/features/checkout/CheckoutForm";
import CheckoutSessionGuard from "@/components/features/checkout/CheckoutSessionGuard";
import ContentionBanner from "@/components/features/checkout/ContentionBanner";
import GuestCheckoutPrompt from "@/components/features/checkout/GuestCheckoutPrompt";
import CheckoutAuthBanner from "@/components/features/checkout/CheckoutAuthBanner";
import CheckoutCodes from "@/components/features/checkout/CheckoutCodes";
import CheckoutTotals from "@/components/features/checkout/CheckoutTotals";
import { listActiveCarriers } from "@/lib/courier/listActiveCarriers";
import { listActiveCustomDeliveryMethods } from "@/lib/courier/listActiveCustomDeliveryMethods";
import type { Address } from "@/types/address-book";
import { strings } from "@/config/strings";

export const metadata = { title: "Ολοκλήρωση παραγγελίας" };
export const dynamic = "force-dynamic";

export default async function CheckoutPage(
  props: {
    searchParams: Promise<{ session?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    // Phase 9: guest checkout is enabled. Most visitors arrive here with
    // an anonymous session already attached (the cart drawer bootstraps
    // one before navigating). The prompt handles the edge case — direct
    // URL, bookmarked link, mid-flow cookie clear — by offering an
    // explicit "Continue as guest" CTA that creates the anon session.
    return <GuestCheckoutPrompt />;
  }

  // Phase 2: customers should arrive at /checkout only via the
  // "Ολοκλήρωση παραγγελίας" button in the cart, which calls
  // startCheckoutSession and appends ?session=<id>. Without a valid soft
  // session we bounce back to /cart so the customer goes through the proper
  // entry point (which engages soft contention).
  const sessionId = searchParams.session;

  // Cart + customer are independent reads — fetch in parallel.
  const [cartRes, { data: custRow }] = await Promise.all([
    getCart(),
    supabase
      .from("customers")
      .select("id, preferred_currency, first_name, last_name, email, phone")
      .eq("auth_user_id", authData.user.id)
      .maybeSingle(),
  ]);
  const cart = cartRes.success ? cartRes.data : null;
  if (!cart || cart.items.length === 0) {
    return (
      <main className="container mx-auto px-4 py-12 max-w-3xl content-reveal">
        <h1 className="text-2xl font-semibold mb-3">{strings.checkout.pageTitle}</h1>
        <p className="text-muted-foreground">
          {strings.checkout.emptyCart}{" "}
          <Link href="/" className="underline">
            {strings.checkout.browseProducts}
          </Link>
        </p>
      </main>
    );
  }
  const customer =
    (custRow as {
      id: string;
      preferred_currency: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      phone: string | null;
    } | null) ?? null;
  if (!customer) redirect("/cart?error=no_customer");

  // Validate the soft session. Must exist, belong to this customer, be in
  // 'soft' state. expires_at may be NULL (uncontended — no deadline) or in
  // the future (contended — deadline must not have passed).
  let validSessionId: string | null = null;
  let sessionExpiresAt: string | null = null;
  let appliedCodes: string[] = [];
  if (sessionId) {
    const admin = createAdminClient();
    const { data: sessionRow } = await admin
      .from("cart_checkout_sessions")
      .select("id, state, expires_at, customer_id, applied_codes")
      .eq("id", sessionId)
      .maybeSingle();
    const session = sessionRow as
      | {
          id: string;
          state: string;
          expires_at: string | null;
          customer_id: string;
          applied_codes: string[];
        }
      | null;
    const expiresOk =
      !session
        ? false
        : session.expires_at === null
          ? true
          : new Date(session.expires_at).getTime() > Date.now();
    if (
      session &&
      session.customer_id === customer.id &&
      session.state === "soft" &&
      expiresOk
    ) {
      validSessionId = session.id;
      sessionExpiresAt = session.expires_at;
      appliedCodes = Array.isArray(session.applied_codes)
        ? session.applied_codes
        : [];
    }
  }
  if (!validSessionId) {
    // No valid soft session — redirect to /cart. The customer will click
    // "Ολοκλήρωση παραγγελίας" there to acquire one. This is the spec
    // design: soft contention engages at the cart click, not on direct
    // navigation to /checkout.
    redirect("/cart?error=session_required");
  }

  // Load saved addresses + active carriers in parallel — both independent
  // of the soft-session validation above. listActiveCarriers reads
  // delivery_carriers (admin-managed, public-RLS for active rows); without
  // it the CheckoutForm can't decide which delivery methods and carriers
  // to show.
  const [{ data: addressRows }, activeCarriers, activeCustomMethods] =
    await Promise.all([
      supabase
        .from("addresses")
        .select("*")
        .eq("customer_id", customer.id)
        .order("is_default_shipping", { ascending: false })
        .order("created_at", { ascending: false }),
      listActiveCarriers(),
      listActiveCustomDeliveryMethods(),
    ]);
  const savedAddresses = (addressRows ?? []) as Address[];

  const currency = customer.preferred_currency ?? "EUR";

  // Discount preview is computed inside <CheckoutTotals> below, so the
  // checkout shell + cart summary paint instantly while the offers
  // engine evaluates in the background and streams in. The
  // authoritative discount is still re-evaluated at placeOrder time.

  return (
    <main className="container mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-8 max-w-6xl content-reveal">
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Ολοκλήρωση παραγγελίας</h1>
        <CheckoutSessionGuard sessionId={validSessionId} />
        <ContentionBanner sessionId={validSessionId} />
        {authData.user.is_anonymous && (
          <CheckoutAuthBanner sessionId={validSessionId} />
        )}
        <CheckoutForm
          savedAddresses={savedAddresses}
          currency={currency}
          subtotal={cart.subtotal}
          itemCount={cart.items.reduce((s, i) => s + i.quantity, 0)}
          checkoutSessionId={validSessionId}
          activeCarriers={activeCarriers}
          activeCustomMethods={activeCustomMethods}
          initialBuyer={{
            first_name: customer.first_name ?? "",
            last_name: customer.last_name ?? "",
            email: customer.email ?? "",
            // Phone may be stored as E.164 (e.g. "+30210...") from prior
            // orders. CheckoutForm's PhoneCountryInput handles re-parsing
            // a leading + on first render.
            phone: customer.phone ?? "",
            phoneCountry: "GR",
          }}
        />
      </section>

      <aside className="border rounded p-4 h-fit sticky top-4">
        <h2 className="font-medium mb-3">Σύνοψη καλαθιού</h2>
        <ul className="text-sm divide-y">
          {cart.items.map((it) => (
            <li key={it.id} className="py-2 flex justify-between gap-3">
              <span className="flex-1">
                {it.product_name}
                <span className="text-muted-foreground"> × {it.quantity}</span>
                {it.variant_label && (
                  <span className="block text-xs text-muted-foreground font-mono">
                    {it.variant_label}
                  </span>
                )}
              </span>
              <span className="font-mono">
                {formatCurrency(it.unit_price * it.quantity, currency)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3 pt-3 border-t space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Υποσύνολο</span>
            <span>{formatCurrency(cart.subtotal, currency)}</span>
          </div>
          {/* The discount + total rows + disclaimer all depend on the
              offers engine evaluating. Stream them in via <Suspense>
              so the shell paints without waiting on the engine. */}
          <Suspense fallback={<TotalsFallback subtotal={cart.subtotal} currency={currency} />}>
            <CheckoutTotals
              cartItems={cart.items.map((i) => ({
                id: i.id,
                product_id: i.product_id,
                variant_id: i.variant_id,
                quantity: i.quantity,
                unit_price: i.unit_price,
              }))}
              subtotal={cart.subtotal}
              currency={currency}
              customerId={customer.id}
              isAuthenticated={!authData.user.is_anonymous}
              appliedCodes={appliedCodes}
            />
          </Suspense>
        </div>
        {validSessionId && (
          <CheckoutCodes
            sessionId={validSessionId}
            initialCodes={appliedCodes}
          />
        )}
      </aside>
    </main>
  );
}

/**
 * Placeholder rendered inside the totals <Suspense> while the offers
 * engine evaluates. Shows the subtotal as the running total — same
 * shape as the final paint, so the layout doesn't shift when the
 * actual <CheckoutTotals> swaps in.
 */
function TotalsFallback({
  subtotal,
  currency,
}: {
  subtotal: number;
  currency: string;
}) {
  return (
    <>
      <div className="flex justify-between font-medium pt-1 mt-1 border-t">
        <span>Σύνολο προϊόντων</span>
        <span>{formatCurrency(subtotal, currency)}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        Μεταφορικά + ΦΠΑ υπολογίζονται μετά την επιλογή τρόπου παράδοσης.
      </p>
    </>
  );
}
