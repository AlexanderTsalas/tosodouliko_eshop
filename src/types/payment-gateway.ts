export type PaymentIntentStatus =
  | "pending"
  | "requires_action"
  | "processing"
  | "succeeded"
  | "canceled"
  | "failed"
  | "session_pending"
  | "session_expired";

export interface PaymentIntent {
  id: string;
  /** Stripe Payment Intent id (pi_*). Nullable for Checkout Session rows
   *  that haven't yet been advanced to processing — set when Stripe fires
   *  the underlying intent event. */
  stripe_payment_intent_id: string | null;
  /** Stripe Checkout Session id (cs_*). Set on session creation. */
  stripe_checkout_session_id: string | null;
  /** URL Stripe redirects the customer to. Set on session creation. */
  checkout_session_url: string | null;
  /** When the Checkout Session expires (Stripe-controlled). */
  checkout_session_expires_at: string | null;
  order_id: string | null;
  amount: number;
  currency: string;
  status: PaymentIntentStatus;
  user_id: string | null;
  client_secret: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentTransaction {
  id: string;
  payment_intent_id: string;
  stripe_charge_id: string | null;
  amount: number;
  status: string;
  failure_reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface CreateCheckoutSessionResult {
  sessionId: string;
  /** Fully-qualified URL the customer should be redirected to. */
  url: string;
  /** Unix-seconds expiry echoed back by the provider. */
  expiresAt: number;
}
