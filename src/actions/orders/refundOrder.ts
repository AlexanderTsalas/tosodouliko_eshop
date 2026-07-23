"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission, requireMFA } from "@/lib/rbac";
import { getActiveProvider } from "@/lib/payment";
import { checkRateLimit } from "@/lib/rate-limit";
import { fail, ok, concurrentEdit, type Result } from "@/types/result";

// Inventory effect helpers — same logic as src/types/order-history.ts
// hasInventoryEffect / isReservationConsumed, inlined here so the
// refund path doesn't need to import them just to compute the
// restore-inventory boolean we pass into refund_order_atomic.
function shouldRestoreInventory(
  payment_method: string,
  fulfillment_status: string
): boolean {
  // Only Stripe orders that decremented stock but haven't physically
  // shipped. Reserved-path orders (COD/cash/bank) need explicit
  // cancellation via transitionOrderStatus to release reservations;
  // refund alone doesn't touch inventory for those.
  return (
    payment_method === "stripe" &&
    fulfillment_status !== "shipped" &&
    fulfillment_status !== "ready_for_pickup" &&
    fulfillment_status !== "delivered" &&
    fulfillment_status !== "picked_up"
  );
}

const Schema = z.object({
  orderId: z.string().uuid(),
  amountMinor: z.number().int().positive().optional(), // in cents; defaults to full refund
  reason: z.string().max(2000).optional(),
  /** Optimistic-lock guard from the page that rendered the refund button. */
  expected_updated_at: z.string().optional(),
});

/**
 * Refund an order. Behavior depends on `payment_method`:
 *
 *   - stripe → call the active payment provider's refund API. With the
 *     mock provider this is a no-op that records a fake refund id; with
 *     real Stripe it moves money back to the customer.
 *   - cod / cash_on_pickup / bank_transfer → no external API to call.
 *     The admin physically handled the money return; this action just
 *     records that the payment was refunded in our system.
 *
 * After a successful refund, `payment_status='refunded'`. Inventory is
 * restored only for Stripe orders that had already decremented stock but
 * hadn't shipped (shipped items have physically left and aren't returnable
 * to available without a manual receive).
 *
 * Idempotent: if already refunded, returns BAD_STATE rather than re-issuing.
 */
export async function refundOrder(
  input: z.input<typeof Schema>
): Promise<Result<{ refundId: string; amount: number }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ refundId: string; amount: number }>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:orders"))) {
    return fail<{ refundId: string; amount: number }>("Forbidden", "FORBIDDEN");
  }
  // Destructive action involving real money — require fresh MFA.
  await requireMFA();

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<{ refundId: string; amount: number }>("Not authenticated", "UNAUTHENTICATED");
  }

  // Per-admin rate limit — prevents a compromised admin session from
  // bulk-refunding (e.g., draining funds via mass-refund script). 20
  // refunds per hour per admin is plenty for normal customer-service work
  // while bounding the blast radius of a credential compromise.
  const rl = await checkRateLimit({
    key: `refund-order:${authData.user.id}`,
    limit: 20,
    windowMs: 60 * 60_000,
  });
  if (!rl.allowed) {
    return fail<{ refundId: string; amount: number }>(
      "Too many refunds in the last hour — try again later",
      "RATE_LIMITED"
    );
  }

  const admin = createAdminClient();

  const { data: order } = await admin
    .from("orders")
    .select("id, payment_status, fulfillment_status, payment_method, total, currency, updated_at")
    .eq("id", parsed.data.orderId)
    .maybeSingle();
  if (!order) {
    return fail<{ refundId: string; amount: number }>("Order not found", "NOT_FOUND");
  }
  const orderRow = order as {
    id: string;
    payment_status: string;
    fulfillment_status: string;
    payment_method: "stripe" | "cod" | "cash_on_pickup" | "bank_transfer";
    total: number | string;
    currency: string;
    updated_at: string;
  };

  // Optimistic-lock check — performed BEFORE any destructive side
  // effect (especially the Stripe refund API call further down). If
  // the order has been advanced by anyone else since the refund UI
  // loaded, refuse the entire operation rather than risk issuing a
  // Stripe refund against stale state.
  if (
    parsed.data.expected_updated_at &&
    orderRow.updated_at !== parsed.data.expected_updated_at
  ) {
    return concurrentEdit<{ refundId: string; amount: number }>();
  }

  if (orderRow.payment_status === "refunded") {
    return fail<{ refundId: string; amount: number }>("Already refunded", "ALREADY_REFUNDED");
  }
  if (orderRow.payment_status !== "paid") {
    return fail<{ refundId: string; amount: number }>(
      `Cannot refund from payment_status ${orderRow.payment_status}`,
      "BAD_STATE"
    );
  }

  // ---------------------------------------------------------------------------
  // Money side — varies by payment method.
  // ---------------------------------------------------------------------------

  let refundId: string;
  let refundAmountMinor: number;

  if (orderRow.payment_method === "stripe") {
    // Find the most-recent succeeded payment intent for this order.
    const { data: pi } = await admin
      .from("payment_intents")
      .select("stripe_payment_intent_id, amount, status")
      .eq("order_id", parsed.data.orderId)
      .eq("status", "succeeded")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!pi) {
      return fail<{ refundId: string; amount: number }>(
        "No succeeded payment intent on file for this Stripe order.",
        "NO_PAYMENT"
      );
    }
    const intent = pi as { stripe_payment_intent_id: string; amount: number };

    const provider = getActiveProvider();
    try {
      const r = await provider.refund({
        provider_intent_id: intent.stripe_payment_intent_id,
        amount_minor: parsed.data.amountMinor ?? intent.amount,
        reason: parsed.data.reason,
      });
      refundId = r.provider_refund_id;
      refundAmountMinor = r.amount_minor;
    } catch (err) {
      return fail<{ refundId: string; amount: number }>(
        `${provider.kind}: ${(err as Error).message}`,
        "PROVIDER_ERROR"
      );
    }
  } else {
    // COD / cash_on_pickup / bank_transfer — no external system to call.
    // Admin handled the physical refund off-band; record it here.
    refundAmountMinor = parsed.data.amountMinor ?? Math.round(Number(orderRow.total) * 100);
    refundId = `manual-${orderRow.payment_method}-${Date.now()}`;
  }

  // ---------------------------------------------------------------------------
  // System side — atomic via refund_order_atomic.
  // ---------------------------------------------------------------------------

  // Fulfillment-status transition on refund:
  //   pre-shipment  → 'cancelled' (never going out)
  //   post-shipment → 'returned'  (out the door, customer returned)
  //   already terminal exception → no change
  const PRE_SHIPMENT_STATES = new Set([
    "draft",
    "pending",
    "confirmed",
    "preparing",
    "label_created",
    "awaiting_carrier",
  ]);
  const POST_SHIPMENT_STATES = new Set([
    "shipped",
    "in_transit",
    "out_for_delivery",
    "arrived_at_pickup",
    "ready_for_pickup",
    "on_hold",
    "delivered",
    "picked_up",
    "collected",
    "delivery_attempted_absent",
    "delivery_attempted_refused",
    "delivery_attempted_wrong_address",
    "delivery_attempted_damaged",
  ]);
  let nextFulfillment: string | null = null;
  if (PRE_SHIPMENT_STATES.has(orderRow.fulfillment_status)) {
    nextFulfillment = "cancelled";
  } else if (POST_SHIPMENT_STATES.has(orderRow.fulfillment_status)) {
    nextFulfillment = "returned";
  }

  // ALL system-side writes — order patch + inventory restore + audit
  // log — happen inside one Postgres transaction via refund_order_atomic.
  // External provider refund already succeeded above; we now record it.
  const { error: rpcErr } = await admin.rpc("refund_order_atomic" as never, {
    p_order_id: parsed.data.orderId,
    p_actor_id: authData.user.id,
    p_refund_id: refundId,
    p_refund_amount_minor: refundAmountMinor,
    p_currency: orderRow.currency,
    p_payment_method: orderRow.payment_method,
    p_next_fulfillment: nextFulfillment,
    p_restore_inventory: shouldRestoreInventory(
      orderRow.payment_method,
      orderRow.fulfillment_status
    ),
    p_reason: parsed.data.reason ?? null,
    p_expected_updated_at: parsed.data.expected_updated_at ?? null,
  } as never);

  if (rpcErr) {
    // The external refund already succeeded — the DB write failed.
    // This is a critical inconsistency that needs manual investigation.
    // Surface it loudly via the error code so logs can spot it.
    if (rpcErr.message?.includes("CONCURRENT_EDIT")) {
      return concurrentEdit<{ refundId: string; amount: number }>();
    }
    if (rpcErr.message?.includes("ALREADY_REFUNDED")) {
      return fail<{ refundId: string; amount: number }>(
        `Order was concurrently refunded — external refund id ${refundId} may be a duplicate.`,
        "ALREADY_REFUNDED"
      );
    }
    if (rpcErr.message?.includes("BAD_STATE")) {
      return fail<{ refundId: string; amount: number }>(
        `${rpcErr.message} — external refund id ${refundId} succeeded but DB rejected. INVESTIGATE.`,
        "REFUND_DB_DRIFT"
      );
    }
    return fail<{ refundId: string; amount: number }>(
      `Refund DB write failed: ${rpcErr.message}. External refund ${refundId} was issued — INVESTIGATE.`,
      "REFUND_DB_DRIFT"
    );
  }

  revalidatePath(`/admin/orders/${parsed.data.orderId}`);
  revalidatePath("/admin/inventory");
  return ok({ refundId, amount: refundAmountMinor });
}
