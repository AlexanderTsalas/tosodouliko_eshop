"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { sendEmail } from "@/lib/transactional-emails";
import { dispatchWishlistNotifications } from "@/lib/wishlist/dispatchNotifications";
import { fail, ok, concurrentEdit, type Result } from "@/types/result";
import {
  hasInventoryEffect,
  isReservationConsumed,
  type FulfillmentStatus,
  type PaymentStatus,
  type Order,
} from "@/types/order-history";

/**
 * Unified order-state action. Accepts an optional target for either axis and
 * applies the inventory side-effects implied by the (paymentMethod, before,
 * after) tuple.
 *
 * Inventory rules (post-Phase 1 of the inventory-contention design — every
 * payment method reserves at placement):
 *   - Leaving 'draft' on any order -> reserve_inventory for each item
 *     (the admin createOrder path is the only one that produces drafts; the
 *     customer placeOrder path inserts orders directly into 'pending' with
 *     reservation already applied via reserveAllOrFail).
 *   - Reaching consumed state (Stripe: payment_status='paid'; non-Stripe:
 *     delivered|picked_up + paid) -> consume_reservation (items committed).
 *   - Moving to 'cancelled' from a state that had an inventory effect:
 *       * reservation not yet consumed -> release_reservation
 *       * reservation already consumed -> restore_inventory (give units back
 *         to available; nothing left in reserved to undo).
 */
const Schema = z.object({
  orderId: z.string().uuid(),
  /**
   * Optimistic-lock guard. The page that rendered this form captured
   * `orders.updated_at` at load time and passes it back here. The
   * UPDATE includes a `WHERE updated_at = expected_updated_at`
   * predicate; if anyone (admin, webhook, cron) advanced the row
   * since, the WHERE matches no rows and we return CONCURRENT_EDIT.
   *
   * Optional for back-compat — actions called without it skip the
   * lock and behave like before. New callers (UI forms) should pass
   * it; programmatic callers (webhooks, internal flows) may omit it.
   */
  expected_updated_at: z.string().optional(),
  // Full DB-enum surface (expanded by migration 20260601000023). The
  // client-side dropdown derives valid next states from the carrier's
  // timeline; this server validator just enforces that the value
  // belongs to a status the DB will accept.
  fulfillment_status: z
    .enum([
      "draft",
      "pending",
      "confirmed",
      "preparing",
      "shipped",
      "ready_for_pickup",
      "delivered",
      "picked_up",
      "cancelled",
      "label_created",
      "awaiting_carrier",
      "in_transit",
      "out_for_delivery",
      "arrived_at_pickup",
      "on_hold",
      "collected",
      "delivery_attempted_absent",
      "delivery_attempted_refused",
      "delivery_attempted_wrong_address",
      "delivery_attempted_damaged",
      "returning",
      "returned",
      "lost",
    ])
    .optional(),
  payment_status: z.enum(["pending", "paid", "refunded", "failed"]).optional(),
});

// Server-side transition sanity gate. The CLIENT (OrderStatusSelect)
// computes the actual valid set from the carrier's timeline; this map
// catches obvious roll-backs (e.g. delivered → preparing) and accepts
// the rest. The legacy spine is enforced explicitly; new-vocabulary
// transitions are accepted along carrier-agnostic forward edges.
const FULFILLMENT_TRANSITIONS: Record<FulfillmentStatus, FulfillmentStatus[]> = {
  // Legacy spine
  draft:            ["pending", "confirmed", "cancelled"],
  pending:          ["confirmed", "cancelled"],
  confirmed:        ["preparing", "cancelled"],
  preparing:        ["shipped", "label_created", "ready_for_pickup", "cancelled"],
  shipped:          ["delivered", "in_transit", "out_for_delivery", "cancelled"],
  ready_for_pickup: ["picked_up", "collected", "cancelled"],
  delivered:        [],
  picked_up:        [],
  cancelled:        [],
  // New vocabulary — forward edges along the carrier-agnostic flow.
  label_created:                    ["awaiting_carrier", "in_transit", "cancelled"],
  awaiting_carrier:                 ["in_transit", "cancelled"],
  in_transit:                       ["out_for_delivery", "arrived_at_pickup", "on_hold", "returning", "lost"],
  out_for_delivery:                 ["delivered", "delivery_attempted_absent", "delivery_attempted_refused", "delivery_attempted_wrong_address", "delivery_attempted_damaged", "returning"],
  arrived_at_pickup:                ["collected", "returning"],
  on_hold:                          ["in_transit", "cancelled"],
  collected:                        [],
  delivery_attempted_absent:        ["out_for_delivery", "returning"],
  delivery_attempted_refused:       ["out_for_delivery", "returning"],
  delivery_attempted_wrong_address: ["out_for_delivery", "returning"],
  delivery_attempted_damaged:       ["returning"],
  returning:                        ["returned"],
  returned:                         [],
  lost:                             [],
};

const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  pending:  ["paid", "failed"],
  paid:     ["refunded"],
  refunded: [], // terminal
  failed:   [], // terminal
};

export async function transitionOrderStatus(
  input: z.input<typeof Schema>
): Promise<Result<{ fulfillment_status: FulfillmentStatus; payment_status: PaymentStatus }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail("Invalid input", "INVALID_INPUT");
  }
  if (!parsed.data.fulfillment_status && !parsed.data.payment_status) {
    return fail("Must specify at least one of fulfillment_status or payment_status", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:orders"))) {
    return fail("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail("Not authenticated", "UNAUTHENTICATED");

  const { data: orderRow } = await supabase
    .from("orders")
    .select(
      "id, order_number, customer_id, customer_email_at_order, payment_method, payment_status, fulfillment_status, customers(email)"
    )
    .eq("id", parsed.data.orderId)
    .maybeSingle();

  if (!orderRow) return fail("Order not found", "NOT_FOUND");
  const before = orderRow as {
    id: string;
    order_number: string;
    customer_id: string;
    customer_email_at_order: string | null;
    payment_method: Order["payment_method"];
    payment_status: Order["payment_status"];
    fulfillment_status: Order["fulfillment_status"];
    customers: { email: string | null } | { email: string | null }[] | null;
  };

  const targetFulfillment = parsed.data.fulfillment_status ?? before.fulfillment_status;
  const targetPayment = parsed.data.payment_status ?? before.payment_status;

  if (parsed.data.fulfillment_status &&
      parsed.data.fulfillment_status !== before.fulfillment_status &&
      !FULFILLMENT_TRANSITIONS[before.fulfillment_status].includes(parsed.data.fulfillment_status)) {
    return fail(
      `Cannot transition fulfillment ${before.fulfillment_status} → ${parsed.data.fulfillment_status}`,
      "BAD_TRANSITION"
    );
  }
  if (parsed.data.payment_status &&
      parsed.data.payment_status !== before.payment_status &&
      !PAYMENT_TRANSITIONS[before.payment_status].includes(parsed.data.payment_status)) {
    return fail(
      `Cannot transition payment ${before.payment_status} → ${parsed.data.payment_status}`,
      "BAD_TRANSITION"
    );
  }

  const admin = createAdminClient();

  // Determine inventory effect to apply.
  const after = {
    payment_method: before.payment_method,
    payment_status: targetPayment,
    fulfillment_status: targetFulfillment,
  };
  const hadEffectBefore = hasInventoryEffect(before);
  const hasEffectAfter = hasInventoryEffect(after);
  const wasConsumed = isReservationConsumed(before);
  const isConsumedAfter = isReservationConsumed(after);

  // Three transitions to detect:
  //   1. none → effect : reserve (admin order leaving 'draft' — placeOrder
  //      already reserves at insert time for all payment methods).
  //   2. reserved → consumed : consume_reservation.
  //   3. has-effect → cancelled : release (if not yet consumed) or restore
  //      (if already consumed).

  let inventoryOp:
    | { kind: "reserve" }
    | { kind: "consume" }
    | { kind: "release" }
    | { kind: "restore" }
    | null = null;

  if (!hadEffectBefore && hasEffectAfter) {
    inventoryOp = { kind: "reserve" };
  } else if (hadEffectBefore && !wasConsumed && isConsumedAfter) {
    inventoryOp = { kind: "consume" };
  } else if (hadEffectBefore && targetFulfillment === "cancelled") {
    inventoryOp = wasConsumed ? { kind: "restore" } : { kind: "release" };
  }

  if (inventoryOp) {
    const { data: items } = await admin
      .from("order_items")
      .select("variant_id, quantity")
      .eq("order_id", before.id);
    const rows = (
      (items ?? []) as Array<{ variant_id: string | null; quantity: number }>
    ).filter((r): r is { variant_id: string; quantity: number } => r.variant_id !== null);

    if (rows.length > 0) {
      // Atomic batch op — single round-trip, single Postgres transaction.
      // Phase 2 batch RPCs cover the four inventory ops. consume_reservation
      // doesn't yet have a batch variant (only called inside
      // fulfill_order_atomic which loops in PG), so a 'consume' kind still
      // uses the per-row RPC loop until Phase 3+ extends batching there.
      const BATCH_RPC_BY_KIND: Record<
        Exclude<typeof inventoryOp.kind, "consume">,
        string
      > = {
        reserve: "reserve_inventory_batch",
        release: "release_reservation_batch",
        restore: "restore_inventory_batch",
      };

      if (inventoryOp.kind === "consume") {
        // No batch variant; loop the per-row consume_reservation. Same
        // shape as the legacy code for this one branch.
        for (const r of rows) {
          const { error: rpcErr } = await admin.rpc("consume_reservation" as never, {
            p_variant_id: r.variant_id,
            p_qty: r.quantity,
          } as never);
          if (rpcErr) {
            return fail(
              `Inventory op consume_reservation failed: ${rpcErr.message}`,
              rpcErr.code
            );
          }
        }
      } else {
        const batchRpcName = BATCH_RPC_BY_KIND[inventoryOp.kind];
        const { error: rpcErr } = await admin.rpc(batchRpcName as never, {
          p_lines: rows.map((r) => ({ variant_id: r.variant_id, qty: r.quantity })),
        } as never);
        if (rpcErr) {
          return fail(
            `Inventory op ${batchRpcName} failed: ${rpcErr.message}`,
            rpcErr.code
          );
        }
      }

      // Phase 6: wake the wishlist dispatcher inline for release/restore
      // ops so queued subscribers don't wait for the periodic tickle sweep.
      // Best-effort — dispatcher never throws.
      if (inventoryOp.kind === "release" || inventoryOp.kind === "restore") {
        for (const r of rows) {
          await dispatchWishlistNotifications({
            variant_id: r.variant_id,
            released_qty: r.quantity,
            triggered_by: "cod_cancel",
          });
        }
      }
    }
  }

  // Persist new state(s).
  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.fulfillment_status) updatePayload.fulfillment_status = parsed.data.fulfillment_status;
  if (parsed.data.payment_status) updatePayload.payment_status = parsed.data.payment_status;

  // Special case: Stripe payment_status -> 'paid' implicitly advances fulfillment
  // to 'confirmed' if still 'pending'. This is what the Stripe webhook does too.
  if (
    parsed.data.payment_status === "paid" &&
    before.payment_method === "stripe" &&
    before.fulfillment_status === "pending"
  ) {
    updatePayload.fulfillment_status = "confirmed";
  }

  // Optimistic-lock UPDATE. The `.eq("updated_at", expected_updated_at)`
  // predicate makes the write conditional on the row not having
  // advanced since the form loaded. If a concurrent admin/webhook
  // moved the row, the UPDATE matches zero rows and we surface a
  // CONCURRENT_EDIT result so the UI can prompt for reload.
  //
  // When the caller doesn't pass expected_updated_at (programmatic
  // / webhook callers that don't render a form), the predicate is
  // skipped — preserves the legacy unconditional write for those
  // paths.
  let query = admin.from("orders").update(updatePayload).eq("id", before.id);
  if (parsed.data.expected_updated_at) {
    query = query.eq("updated_at", parsed.data.expected_updated_at);
  }
  const { data: updatedRows, error: updateErr } = await query.select("id");
  if (updateErr) return fail(updateErr.message, updateErr.code);
  if (parsed.data.expected_updated_at && (!updatedRows || updatedRows.length === 0)) {
    return concurrentEdit();
  }

  // Notify customer on user-visible fulfillment transitions.
  const visible: FulfillmentStatus[] = ["shipped", "delivered", "picked_up", "cancelled"];
  if (parsed.data.fulfillment_status && visible.includes(parsed.data.fulfillment_status)) {
    const customer = Array.isArray(before.customers) ? before.customers[0] : before.customers;
    const email = customer?.email ?? before.customer_email_at_order ?? null;
    if (email) {
      await sendEmail({
        to: email,
        subject: `Παραγγελία ${before.order_number} — ${parsed.data.fulfillment_status}`,
        text: `Η παραγγελία σας άλλαξε σε κατάσταση: ${parsed.data.fulfillment_status}`,
        templateId: `order.${parsed.data.fulfillment_status}`,
      });
    }
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "order.status.transitioned",
    resource_type: "order",
    resource_id: before.id,
    metadata: {
      fulfillment_from: before.fulfillment_status,
      fulfillment_to: updatePayload.fulfillment_status ?? before.fulfillment_status,
      payment_from: before.payment_status,
      payment_to: updatePayload.payment_status ?? before.payment_status,
      inventory_op: inventoryOp?.kind ?? null,
    },
  });

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${before.id}`);
  revalidatePath("/admin/inventory");
  return ok({
    fulfillment_status: (updatePayload.fulfillment_status ?? before.fulfillment_status) as FulfillmentStatus,
    payment_status: (updatePayload.payment_status ?? before.payment_status) as PaymentStatus,
  });
}
