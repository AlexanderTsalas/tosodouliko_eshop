import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fulfillOrder } from "@/lib/fulfillment/fulfillOrder";
import { logAuditEvent } from "@/lib/audit-log";
import { dispatchWishlistNotifications } from "@/lib/wishlist/dispatchNotifications";

/**
 * Shared "checkout session completed" handler. Both the real Stripe webhook
 * (on `checkout.session.completed`) and the mock-payment webhook funnel here
 * so the order-state + fulfillment flow is identical regardless of provider.
 *
 * Phase 3 of the data-layer remediation collapsed the payment_intents flip
 * + orders flip + audit log into a single atomic RPC
 * (`handle_session_completed_atomic`). The inventory consume + email send
 * still happen in a follow-up `fulfillOrder` call which is itself atomic
 * via `fulfill_order_atomic`. Keeping them as two RPCs (rather than one
 * mega-RPC) makes failure recovery cleaner — the webhook can retry just
 * the fulfill step without re-running the payment flip.
 *
 * Idempotency: each RPC's predicates ensure concurrent webhook retries
 * safely no-op. `fulfillOrder` early-returns when fulfillment_status is
 * already past 'preparing'.
 */
export async function handleSessionCompleted(args: {
  provider: string;
  provider_session_id: string;
  /** Stripe Payment Intent id that backs the session, when known (Stripe webhook
   *  payload includes it). Stored alongside for traceability. */
  provider_intent_id?: string | null;
}): Promise<{ orderId: string | null }> {
  const admin = createAdminClient();

  // Atomic flip: payment_intents + orders + audit_events in one txn.
  const { data: rpcRes, error: rpcErr } = await admin.rpc(
    "handle_session_completed_atomic" as never,
    {
      p_provider: args.provider,
      p_provider_session_id: args.provider_session_id,
      p_provider_intent_id: args.provider_intent_id ?? null,
    } as never
  );

  if (rpcErr) {
    // Unknown error — let it surface so webhook returns 5xx and Stripe retries
    throw new Error(`handle_session_completed_atomic failed: ${rpcErr.message}`);
  }

  const res = (rpcRes ?? null) as {
    ok: boolean;
    order_id: string | null;
    first_completion: boolean;
    reason: string | null;
  } | null;

  if (!res || res.order_id === null) {
    return { orderId: null };
  }

  // Now consume inventory + flip fulfillment_status to 'preparing' +
  // send the customer email. fulfill_order_atomic is idempotent so a
  // retry after a partial completion (somehow) safely re-runs.
  await fulfillOrder({ orderId: res.order_id });

  return { orderId: res.order_id };
}

/**
 * Counterpart for `checkout.session.async_payment_failed` (Stripe or Mock).
 * Marks the intent row as failed AND releases the inventory reservation tied
 * to the order in ONE Postgres round-trip via release_reservation_batch.
 *
 * Stripe only fires this event on definitive failure (retries on the same
 * intent during card-decline cycles don't fire it). Releasing on this event
 * is the correct atomic action.
 */
export async function handleSessionFailed(args: {
  provider: string;
  provider_session_id: string;
  reason?: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data: intentRow } = await admin
    .from("payment_intents")
    .select("id, order_id, status")
    .eq("stripe_checkout_session_id", args.provider_session_id)
    .maybeSingle();
  if (!intentRow) return;
  const intent = intentRow as { id: string; order_id: string | null; status: string };
  if (intent.status === "succeeded" || intent.status === "failed") return;

  await admin
    .from("payment_intents")
    .update({ status: "failed", updated_at: new Date().toISOString() })
    .eq("id", intent.id);

  if (intent.order_id) {
    await releaseOrderReservations(intent.order_id);
    await admin
      .from("orders")
      .update({
        payment_status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", intent.order_id)
      .eq("payment_status", "pending");
    // Transition the soft-contention session row to 'released' so it stops
    // appearing in admin queues + the reaper doesn't try to release the
    // (already-released) reservation a second time.
    await admin
      .from("cart_checkout_sessions")
      .update({ state: "released", updated_at: new Date().toISOString() })
      .eq("order_id", intent.order_id)
      .in("state", ["soft", "hard"]);
  }

  await logAuditEvent({
    actor_type: "system",
    action: "payment.session.failed",
    resource_type: "payment_intent",
    resource_id: args.provider_session_id,
    metadata: {
      provider: args.provider,
      reason: args.reason ?? null,
      order_id: intent.order_id,
    },
  });
}

/**
 * Counterpart for `checkout.session.expired` (Stripe). Fires when the customer
 * doesn't complete payment within the 30-min Checkout Session window. Releases
 * the inventory reservation; the wishlist-queue activation lands in Phase 6.
 */
export async function handleSessionExpired(args: {
  provider: string;
  provider_session_id: string;
}): Promise<{ orderId: string | null }> {
  const admin = createAdminClient();
  const { data: intentRow } = await admin
    .from("payment_intents")
    .select("id, order_id, status")
    .eq("stripe_checkout_session_id", args.provider_session_id)
    .maybeSingle();
  if (!intentRow) return { orderId: null };
  const intent = intentRow as { id: string; order_id: string | null; status: string };
  if (intent.status === "succeeded") return { orderId: intent.order_id };
  if (intent.status === "session_expired") return { orderId: intent.order_id };

  await admin
    .from("payment_intents")
    .update({ status: "session_expired", updated_at: new Date().toISOString() })
    .eq("id", intent.id)
    .in("status", ["session_pending", "pending"]);

  if (intent.order_id) {
    await releaseOrderReservations(intent.order_id);
    // Transition the soft-contention session row to 'released' so it stops
    // appearing in admin queues + the reaper doesn't try to release the
    // (already-released) reservation a second time.
    await admin
      .from("cart_checkout_sessions")
      .update({ state: "released", updated_at: new Date().toISOString() })
      .eq("order_id", intent.order_id)
      .in("state", ["soft", "hard"]);
  }

  await logAuditEvent({
    actor_type: "system",
    action: "payment.session.expired",
    resource_type: "payment_intent",
    resource_id: args.provider_session_id,
    metadata: { provider: args.provider, order_id: intent.order_id },
  });

  return { orderId: intent.order_id };
}

/**
 * Releases reservations for every line item on an order in ONE round-trip
 * via release_reservation_batch (Phase 2 of the data-layer remediation).
 * Best-effort wishlist dispatch happens after the batch succeeds.
 *
 * Used by the session-expired and session-failed handlers when the Stripe
 * payment never landed. If the batch fails, we still try the wishlist
 * dispatch best-effort for any items we know about — admins can recover
 * stuck reservations via the inventory page.
 */
async function releaseOrderReservations(orderId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: items } = await admin
    .from("order_items")
    .select("variant_id, quantity")
    .eq("order_id", orderId);
  const rows = (
    (items ?? []) as Array<{ variant_id: string | null; quantity: number }>
  ).filter((r): r is { variant_id: string; quantity: number } => r.variant_id !== null);

  if (rows.length === 0) return;

  const { error } = await admin.rpc("release_reservation_batch" as never, {
    p_lines: rows.map((r) => ({ variant_id: r.variant_id, qty: r.quantity })),
  } as never);

  if (error) {
    console.error(
      `[handleSessionEvents] release_reservation_batch failed for order ${orderId} (${error.code}): ${error.message}`
    );
    // Don't return early — still dispatch wishlist notifications for
    // any items, on the optimistic assumption the inventory state was
    // released by a partial-success or another path. dispatch never
    // throws so this is safe.
  }

  // Wake the wishlist dispatcher for every released line IN PARALLEL.
  // The Stripe webhook has a 10s timeout; sequential dispatch per line
  // would stack latency and push borderline cases over the budget.
  // Follow-up Promise.all the dispatch fan-out. Dispatcher
  // already swallows errors internally so Promise.all is safe.
  await Promise.all(
    rows.map((r) =>
      dispatchWishlistNotifications({
        variant_id: r.variant_id,
        released_qty: r.quantity,
        triggered_by: "stripe_abandon",
      })
    )
  );
}
