/**
 * Common shape every payment provider implements. Stripe-backed for production
 * (using Stripe Checkout Sessions, which redirect the customer to Stripe's
 * hosted checkout page) and Mock-backed for design/testing/running without an
 * external account.
 *
 * Phase 0 migrated this interface from Payment Intents (in-page Stripe
 * Elements form) to Checkout Sessions (redirect). The session has a native
 * expires_at that drives the hard-contention 30-min window in the inventory
 * design — see docs/features/inventory-contention-and-notifications.md.
 */

export type PaymentProviderKind = "stripe" | "mock";

export interface CheckoutLineItem {
  /** Customer-facing display name. */
  name: string;
  /** Number of units in this line. */
  quantity: number;
  /** Per-unit price in minor units (cents). */
  unit_amount_minor: number;
}

export interface CreateCheckoutSessionArgs {
  /** The order this session will settle. Recorded on the session + in metadata. */
  order_id: string;
  /** Authenticated user placing the order (snapshotted on the intent row). */
  user_id: string;
  /** ISO 4217 lowercase (e.g., "eur"). */
  currency: string;
  /** Per-line breakdown shown on Stripe's hosted page. */
  line_items: CheckoutLineItem[];
  /** Fully-qualified URL Stripe redirects to on success. */
  success_url: string;
  /** Fully-qualified URL Stripe redirects to on cancel. */
  cancel_url: string;
  /** Session expiry in seconds-since-epoch. Stripe minimum is 30 min from now. */
  expires_at: number;
  /** Provider-specific metadata to pass through (logged but otherwise opaque). */
  metadata?: Record<string, string>;
}

export interface CreateCheckoutSessionResult {
  /** Provider-issued unique session id (Stripe cs_*, or mock-generated). */
  provider_session_id: string;
  /** URL the customer is redirected to in order to enter payment details. */
  url: string;
  /** Echo of the expiry the provider accepted (may equal or exceed requested). */
  expires_at: number;
}

export interface RefundArgs {
  /**
   * Stripe Payment Intent id (pi_*) of the underlying intent. For Checkout
   * Sessions, this is the id Stripe surfaces once the session has been paid
   * — typically read from the success webhook payload.
   */
  provider_intent_id: string;
  amount_minor?: number;
  reason?: string;
}

export interface RefundResult {
  provider_refund_id: string;
  amount_minor: number;
}

/**
 * Implementations live in src/lib/payment/providers/*.ts. The entry point in
 * src/lib/payment/index.ts picks one at runtime based on PAYMENT_PROVIDER env
 * and exposes a single API surface to the rest of the app.
 */
export interface PaymentProvider {
  kind: PaymentProviderKind;
  createCheckoutSession(
    args: CreateCheckoutSessionArgs
  ): Promise<CreateCheckoutSessionResult>;
  refund(args: RefundArgs): Promise<RefundResult>;
}
