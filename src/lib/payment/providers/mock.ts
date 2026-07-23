import { randomUUID } from "node:crypto";
import type {
  CreateCheckoutSessionArgs,
  CreateCheckoutSessionResult,
  PaymentProvider,
  RefundArgs,
  RefundResult,
} from "../types";

/**
 * Mock payment provider for development, prototyping, and the entire
 * checkout-design phase before Stripe is wired up.
 *
 * Mirrors the Stripe Checkout Sessions shape:
 *  - createCheckoutSession: generates a fake `cs_mock_<uuid>` id and a URL
 *    pointing at a local mock-checkout page (/checkout/mock/<session_id>).
 *  - The mock-checkout page renders "Simulate success / Simulate decline"
 *    buttons that POST to /api/webhooks/mock-payment, which calls the same
 *    shared handlers the real Stripe webhook does.
 *  - refund: returns a fake refund id, doesn't touch any external system.
 *
 * Switch to real Stripe later by populating STRIPE_SECRET_KEY +
 * STRIPE_WEBHOOK_SECRET in the env, and setting PAYMENT_PROVIDER=stripe
 * (or just unset PAYMENT_PROVIDER — the dispatcher uses stripe when its keys
 * are configured).
 */
export const mockProvider: PaymentProvider = {
  kind: "mock",

  async createCheckoutSession(
    args: CreateCheckoutSessionArgs
  ): Promise<CreateCheckoutSessionResult> {
    const sessionId = `cs_mock_${randomUUID()}`;
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    return {
      provider_session_id: sessionId,
      url: `${baseUrl}/checkout/mock/${sessionId}`,
      expires_at: args.expires_at,
    };
  },

  async refund(args: RefundArgs): Promise<RefundResult> {
    return {
      provider_refund_id: `re_mock_${randomUUID()}`,
      amount_minor: args.amount_minor ?? 0,
    };
  },
};
