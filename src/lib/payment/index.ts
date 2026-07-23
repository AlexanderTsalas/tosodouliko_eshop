import "server-only";
import { mockProvider } from "./providers/mock";
import { stripeProvider } from "./providers/stripe";
import type { PaymentProvider, PaymentProviderKind } from "./types";

export type { PaymentProviderKind } from "./types";

/**
 * Resolves the active payment provider. Priority:
 *
 *   1. PAYMENT_PROVIDER env var ("stripe" | "mock") — explicit override.
 *   2. Falls back to "stripe" if STRIPE_SECRET_KEY is set with a real key.
 *   3. Falls back to "mock" otherwise (no external services required).
 *
 * This means: zero config → checkout works end-to-end with the mock provider.
 * Set STRIPE_SECRET_KEY in env → checkout flips to real Stripe automatically.
 * Set PAYMENT_PROVIDER=mock → force mock even if Stripe keys are present
 * (useful for staging/preview deployments).
 */
export function activeProviderKind(): PaymentProviderKind {
  const explicit = process.env.PAYMENT_PROVIDER;
  if (explicit === "stripe" || explicit === "mock") return explicit;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey && !stripeKey.startsWith("sk_test_placeholder")) return "stripe";
  return "mock";
}

export function getActiveProvider(): PaymentProvider {
  return activeProviderKind() === "stripe" ? stripeProvider : mockProvider;
}

export { stripeProvider, mockProvider };
export type {
  CheckoutLineItem,
  CreateCheckoutSessionArgs,
  CreateCheckoutSessionResult,
  PaymentProvider,
  RefundArgs,
  RefundResult,
} from "./types";
