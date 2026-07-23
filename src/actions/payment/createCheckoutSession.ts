"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit-log";
import { getActiveProvider } from "@/lib/payment";
import { checkRateLimit } from "@/lib/rate-limit";
import { fail, ok, type Result } from "@/types/result";
import type { CreateCheckoutSessionResult } from "@/types/payment-gateway";

const Schema = z.object({
  orderId: z.string().uuid(),
});

/**
 * Create a Stripe Checkout Session for an order. The customer is redirected
 * to Stripe's hosted checkout page (or to the local mock page when the mock
 * provider is active) to complete payment.
 *
 * Caller must be authenticated and own the order (i.e., their customers.id
 * matches orders.customer_id).
 *
 * The session expires 30 minutes from creation — Stripe will fire
 * `checkout.session.expired` at that point, which (in later phases) releases
 * the inventory reservation tied to this checkout.
 */
export async function createCheckoutSession(
  input: z.infer<typeof Schema>
): Promise<Result<CreateCheckoutSessionResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<CreateCheckoutSessionResult>("Invalid input", "INVALID_INPUT");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<CreateCheckoutSessionResult>("Not authenticated", "UNAUTHENTICATED");
  }
  const userId = authData.user.id;

  // Per-user rate limit. Each call hits the Stripe API (real cost in
  // metered providers) and creates a session row in the DB. 10/hour is
  // plenty for a customer who needs to restart a checkout — beyond that
  // they're either confused (and need to contact support) or it's abuse.
  const rl = await checkRateLimit({
    key: `create-checkout-session:${userId}`,
    limit: 10,
    windowMs: 60 * 60_000,
  });
  if (!rl.allowed) {
    return fail<CreateCheckoutSessionResult>(
      "Πολλές προσπάθειες — δοκιμάστε ξανά αργότερα.",
      "RATE_LIMITED"
    );
  }

  // Resolve customer + order + items in parallel — none depend on the
  // others' data (order_items keys on parsed.data.orderId directly).
  // Phase 9 of the data-layer remediation — shaves two round-trips off
  // the hot Stripe-checkout-button latency.
  const [callerCustomerRowRes, orderRes, itemRowsRes] = await Promise.all([
    supabase
      .from("customers")
      .select("id")
      .eq("auth_user_id", userId)
      .maybeSingle(),
    supabase
      .from("orders")
      .select(
        "id, order_number, customer_id, total, currency, payment_status, payment_method"
      )
      .eq("id", parsed.data.orderId)
      .maybeSingle(),
    supabase
      .from("order_items")
      .select("product_name, variant_label, quantity, unit_price")
      .eq("order_id", parsed.data.orderId),
  ]);

  const callerCustomerId =
    (callerCustomerRowRes.data as { id: string } | null)?.id ?? null;
  if (!callerCustomerId) {
    return fail<CreateCheckoutSessionResult>("Customer profile missing", "NO_CUSTOMER");
  }

  if (orderRes.error || !orderRes.data) {
    return fail<CreateCheckoutSessionResult>("Order not found", "ORDER_NOT_FOUND");
  }
  const order = orderRes.data as {
    id: string;
    order_number: string;
    customer_id: string;
    total: number | string;
    currency: string;
    payment_status: string;
    payment_method: string;
  };
  if (order.customer_id !== callerCustomerId) {
    return fail<CreateCheckoutSessionResult>("Forbidden", "FORBIDDEN");
  }
  if (order.payment_method !== "stripe") {
    return fail<CreateCheckoutSessionResult>(
      "Order is not a Stripe payment — no checkout session needed.",
      "BAD_PAYMENT_METHOD"
    );
  }
  if (order.payment_status !== "pending") {
    return fail<CreateCheckoutSessionResult>("Order not in payable state", "BAD_STATE");
  }

  const itemRows = itemRowsRes.data;
  type ItemRow = {
    product_name: string;
    variant_label: string | null;
    quantity: number;
    unit_price: number | string;
  };
  const items = (itemRows ?? []) as ItemRow[];
  if (items.length === 0) {
    return fail<CreateCheckoutSessionResult>(
      "Order has no items",
      "EMPTY_ORDER"
    );
  }

  // Stripe API expects lowercase 3-letter ISO codes ('eur', 'usd'). The
  // rest of our stack stores uppercase ('EUR', 'USD'). The Stripe
  // boundary is the ONE place we lowercase — everywhere else stays
  // uppercase so DB joins/equality checks behave predictably.
  const currency = String(order.currency ?? "EUR").toLowerCase();
  const lineItems = items.map((it) => ({
    name:
      it.variant_label && it.variant_label.length > 0
        ? `${it.product_name} (${it.variant_label})`
        : it.product_name,
    quantity: it.quantity,
    unit_amount_minor: Math.round(Number(it.unit_price) * 100),
  }));

  // Stripe enforces a minimum 30-min expiry from creation. We pass exactly
  // 30 min — the hard-contention release timer in the inventory design hooks
  // into Stripe's checkout.session.expired webhook fired at this moment.
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const successUrl = `${siteUrl}/checkout/success/${order.id}?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${siteUrl}/cart`;

  const provider = getActiveProvider();
  let session;
  try {
    session = await provider.createCheckoutSession({
      order_id: order.id,
      user_id: userId,
      currency,
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      expires_at: expiresAt,
      metadata: { order_number: order.order_number },
    });
  } catch (err) {
    return fail<CreateCheckoutSessionResult>(
      `${provider.kind}: ${(err as Error).message}`,
      "PROVIDER_ERROR"
    );
  }

  // Persist the session. RLS only allows users to SELECT their own intents,
  // so writes go via the admin client.
  const admin = createAdminClient();
  const amountMinor = Math.round(Number(order.total) * 100);
  const { error: insertErr } = await admin.from("payment_intents").insert({
    stripe_checkout_session_id: session.provider_session_id,
    checkout_session_url: session.url,
    checkout_session_expires_at: new Date(session.expires_at * 1000).toISOString(),
    order_id: order.id,
    amount: amountMinor,
    currency,
    status: "session_pending",
    user_id: userId,
  });
  if (insertErr) {
    return fail<CreateCheckoutSessionResult>(
      `Persist failed: ${insertErr.message}. ` +
        `Has migration 20260521120000_payment_checkout_sessions been applied?`,
      insertErr.code ?? "DB_INSERT"
    );
  }

  await logAuditEvent({
    actor_id: userId,
    actor_type: "user",
    action: "payment.checkout_session.created",
    resource_type: "payment_intent",
    resource_id: session.provider_session_id,
    metadata: {
      orderId: order.id,
      amount: amountMinor,
      currency,
      provider: provider.kind,
      expires_at: session.expires_at,
    },
  });

  return ok({
    sessionId: session.provider_session_id,
    url: session.url,
    expiresAt: session.expires_at,
  });
}
