import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";
import {
  handleSessionCompleted,
  handleSessionExpired,
  handleSessionFailed,
} from "@/lib/payment/handleSessionEvents";
import { logAuditEvent } from "@/lib/audit-log";
import { createAdminClient } from "@/lib/supabase/admin";

// Stripe webhook handler — never cache; signature verification + state
// mutation per request.
export const dynamic = "force-dynamic";

/**
 * Stripe webhook receiver.
 *
 * Listens for the Checkout Sessions event family. The Phase 0 migration
 * replaced Payment Intents with Checkout Sessions; the relevant events are:
 *  - checkout.session.completed       → order paid, run fulfillment
 *  - checkout.session.expired         → 30-min window passed without payment
 *  - checkout.session.async_payment_failed → final-state failure
 *
 * Contracts:
 *  - Verify the Stripe signature using STRIPE_WEBHOOK_SECRET BEFORE any work.
 *  - Return 200 ASAP after verifying — defer side-effects to the shared
 *    handlers in src/lib/payment/handleSessionEvents.ts (which the mock
 *    webhook also calls, so behavior is identical between providers).
 *  - Idempotent — duplicate events must not double-process. Handled inside
 *    the shared handlers via guarded UPDATEs.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!secret || !stripeKey || stripeKey.startsWith("sk_test_placeholder")) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2024-10-28.acacia" as Stripe.LatestApiVersion });

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    return NextResponse.json(
      { error: "Signature verification failed: " + (err as Error).message },
      { status: 400 }
    );
  }

  // Idempotency check — has this event already been processed?
  // Stripe's at-least-once delivery + our new 5xx-on-error retry policy
  // means duplicate deliveries happen. The atomic INSERT ... ON
  // CONFLICT below claims the event_id; if we win the race, we proceed
  // to process. If we lose, the event was already handled and we
  // short-circuit with 200 (telling Stripe "yes, got it") without
  // re-running side effects.
  //
  // Stored at "skipped" initially because we haven't done the work yet;
  // updated to "success" only after the handler returns. On handler
  // error we DELETE the row so a retry can claim it again.
  const eventAdmin = createAdminClient();
  const { data: claimed, error: claimErr } = await eventAdmin
    .from("stripe_events_processed")
    .insert({ event_id: event.id, event_type: event.type, outcome: "skipped" })
    .select("event_id")
    .maybeSingle();
  if (claimErr) {
    // The likely culprit: duplicate key (event already claimed). Look
    // up to confirm and short-circuit if so. For any OTHER error
    // (table missing, network), we proceed without dedup rather than
    // blocking real events — better to risk a duplicate retry than
    // drop a legitimate first-time delivery.
    if (claimErr.code === "23505") {
      return NextResponse.json({ received: true, deduped: true });
    }
    // fall through to processing
  } else if (!claimed) {
    // ON CONFLICT DO NOTHING-style empty return → already processed.
    return NextResponse.json({ received: true, deduped: true });
  }

  // Handler errors MUST surface to Stripe as 5xx so Stripe's automatic
  // retry takes over. The previous behavior caught + logged + returned
  // 200, which told Stripe "processed successfully" — meaning a
  // transient DB error during fulfillOrder() would leave the customer
  // paid but the order frozen at payment_status='pending' with no
  // retry attempt.
  //
  // Recovery contract:
  //   - SIGNATURE failures → 400 (Stripe stops retrying; the request
  //     wasn't really from Stripe).
  //   - Unknown event types → 200 + no-op (we don't want Stripe
  //     retrying events we'll never process; they're not errors).
  //   - Handler exception during a KNOWN event type → 500 (Stripe
  //     retries with exponential backoff up to ~3 days).
  //
  // Idempotency: each handler (handleSessionCompleted, etc.) is
  // already guarded against duplicate processing via status-based
  // UPDATEs. A retry that arrives after the first attempt actually
  // succeeded will short-circuit harmlessly. Adding a dedicated
  // stripe_events_processed(event_id) table would belt-and-brace
  // this — flagged for the next iteration.
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleSessionCompleted({
          provider: "stripe",
          provider_session_id: session.id,
          provider_intent_id:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id ?? null,
        });
        break;
      }
      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleSessionExpired({
          provider: "stripe",
          provider_session_id: session.id,
        });
        break;
      }
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleSessionFailed({
          provider: "stripe",
          provider_session_id: session.id,
        });
        break;
      }
      default:
        // Other Stripe events (payment_intent.*, charge.*, etc.) are ignored —
        // we only care about the Checkout Sessions lifecycle. The Payment
        // Intent underneath each session is tracked via the session events.
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Release the dedup claim so the retry can re-acquire it and
    // actually run the work. Without this, the claim row would
    // permanently block retries from running.
    await eventAdmin
      .from("stripe_events_processed")
      .delete()
      .eq("event_id", event.id);
    await logAuditEvent({
      actor_type: "system",
      action: "stripe.webhook.error",
      resource_type: "payment",
      metadata: {
        event_id: event.id,
        event_type: event.type,
        error: message,
        will_retry: true,
      },
    });
    // Return 5xx so Stripe retries this delivery. The handlers are
    // idempotent on success-state, so a retry after a partial-success
    // attempt is safe — it'll short-circuit at the first guard.
    return NextResponse.json(
      { error: `Handler failed (event ${event.id}): ${message}` },
      { status: 500 }
    );
  }

  // Flip the claim's outcome to 'success' now that processing completed
  // without error. (Best-effort — even if this update fails, the row
  // still exists with outcome='skipped' which is enough to dedup.)
  await eventAdmin
    .from("stripe_events_processed")
    .update({ outcome: "success" })
    .eq("event_id", event.id);

  return NextResponse.json({ received: true });
}
