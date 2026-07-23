import Stripe from "stripe";
import type {
  CreateCheckoutSessionArgs,
  CreateCheckoutSessionResult,
  PaymentProvider,
  RefundArgs,
  RefundResult,
} from "../types";

function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.startsWith("sk_test_placeholder")) {
    throw new Error(
      "STRIPE_SECRET_KEY is not configured. Set PAYMENT_PROVIDER=mock to run without Stripe."
    );
  }
  return new Stripe(key, { apiVersion: "2024-10-28.acacia" as Stripe.LatestApiVersion });
}

export const stripeProvider: PaymentProvider = {
  kind: "stripe",

  async createCheckoutSession(
    args: CreateCheckoutSessionArgs
  ): Promise<CreateCheckoutSessionResult> {
    const stripe = stripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      currency: args.currency,
      line_items: args.line_items.map((item) => ({
        quantity: item.quantity,
        price_data: {
          currency: args.currency,
          product_data: { name: item.name },
          unit_amount: item.unit_amount_minor,
        },
      })),
      success_url: args.success_url,
      cancel_url: args.cancel_url,
      expires_at: args.expires_at,
      metadata: {
        order_id: args.order_id,
        user_id: args.user_id,
        ...(args.metadata ?? {}),
      },
      // The Payment Intent created under the hood inherits this metadata —
      // useful when reconciling via the payment_intent.* webhook events as a
      // fallback path.
      payment_intent_data: {
        metadata: {
          order_id: args.order_id,
          user_id: args.user_id,
        },
      },
    });
    if (!session.url) {
      throw new Error("Stripe did not return a checkout URL.");
    }
    return {
      provider_session_id: session.id,
      url: session.url,
      expires_at: session.expires_at,
    };
  },

  async refund(args: RefundArgs): Promise<RefundResult> {
    const stripe = stripeClient();
    const refund = await stripe.refunds.create({
      payment_intent: args.provider_intent_id,
      amount: args.amount_minor,
      reason: args.reason ? "requested_by_customer" : undefined,
      metadata: args.reason ? { admin_reason: args.reason } : undefined,
    });
    return {
      provider_refund_id: refund.id,
      amount_minor: refund.amount,
    };
  },
};
