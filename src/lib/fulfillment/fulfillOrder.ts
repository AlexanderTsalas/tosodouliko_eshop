import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/transactional-emails";
import { logAuditEvent } from "@/lib/audit-log";
import { getWeightedAverageCost } from "@/lib/suppliers/getWeightedAverageCost";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  orderId: z.string().uuid(),
});

/**
 * Mark an order as fulfilling: decrement inventory for every order item, set
 * order.status = 'fulfilling', and email the customer.
 *
 * Idempotent on order status — safe to call multiple times (subsequent calls
 * become no-ops).
 *
 * **Server-only library, not a Server Action.** Previously lived under
 * `src/actions/fulfillment/` which exposed it as a Next.js Server Action
 * endpoint with no auth guard. Real callers are all internal system-context
 * paths (Stripe webhook, mock-payment webhook) authenticated by signature
 * / provider gate, but the Server Action surface was a defense-in-depth
 * gap that allowed any authenticated user to trigger inventory decrement
 * + order-status mutation on any order id they could guess. Moved to
 * `lib/` to remove the action surface entirely. See `docs/technical-debt.md`
 * TD-1.
 */
export async function fulfillOrder(
  input: z.infer<typeof Schema>
): Promise<Result<{ orderId: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<{ orderId: string }>("Invalid input", "INVALID_INPUT");

  const admin = createAdminClient();

  const { data: order, error: oErr } = await admin
    .from("orders")
    .select(
      "id, customer_id, customer_email_at_order, order_number, payment_method, payment_status, fulfillment_status, currency, customers(auth_user_id, email)"
    )
    .eq("id", parsed.data.orderId)
    .maybeSingle();

  if (oErr || !order) return fail<{ orderId: string }>("Order not found", "ORDER_NOT_FOUND");

  const row = order as {
    id: string;
    customer_id: string;
    customer_email_at_order: string | null;
    order_number: string;
    payment_method: string;
    payment_status: string;
    fulfillment_status: string;
    currency: string;
    customers:
      | { auth_user_id: string | null; email: string | null }
      | { auth_user_id: string | null; email: string | null }[]
      | null;
  };
  // Idempotent: already past the inventory-decrement step.
  if (
    row.fulfillment_status === "preparing" ||
    row.fulfillment_status === "shipped" ||
    row.fulfillment_status === "ready_for_pickup" ||
    row.fulfillment_status === "delivered" ||
    row.fulfillment_status === "picked_up"
  ) {
    return ok({ orderId: parsed.data.orderId });
  }
  // fulfillOrder is for Stripe-paid orders that have just transitioned to paid.
  // Non-Stripe orders take the reservation path via transitionOrderStatus.
  if (row.payment_method !== "stripe" || row.payment_status !== "paid") {
    return fail<{ orderId: string }>(
      `Cannot fulfill from (${row.payment_method}, ${row.payment_status}, ${row.fulfillment_status})`,
      "BAD_STATE"
    );
  }

  // ATOMIC inventory consume + status flip via fulfill_order_atomic.
  // The whole order's items are consumed in one Postgres transaction;
  // any partial failure rolls back the entire batch including the
  // status update. Replaces a JS loop of per-item RPCs that could
  // leave items 1-N consumed if item N+1 failed.
  const { data: rpcRes, error: rpcErr } = await admin.rpc(
    "fulfill_order_atomic" as never,
    { p_order_id: parsed.data.orderId } as never
  );
  if (rpcErr) {
    // Map known SQLSTATEs to public failure codes.
    if (rpcErr.code === "IRSRV") {
      return fail<{ orderId: string }>(
        `Inventory error: ${rpcErr.message}`,
        "INSUFFICIENT_RESERVED"
      );
    }
    if (rpcErr.message?.includes("BAD_STATE")) {
      return fail<{ orderId: string }>(rpcErr.message, "BAD_STATE");
    }
    if (rpcErr.message?.includes("ORDER_NOT_FOUND")) {
      return fail<{ orderId: string }>("Order not found", "ORDER_NOT_FOUND");
    }
    return fail<{ orderId: string }>(
      `Inventory error: ${rpcErr.message}`,
      rpcErr.code
    );
  }
  const fulfillRes = (rpcRes ?? null) as {
    ok: boolean;
    already_fulfilled: boolean;
    items_consumed: number;
  } | null;

  // WAC snapshot — happens AFTER the atomic consume + status flip.
  // The cost-snapshot is a reporting concern, not a correctness
  // concern, so it stays best-effort in JS rather than being baked
  // into the atomic RPC (porting the currency-matching logic to SQL
  // would duplicate state across two places). Idempotent: only fills
  // unit_cost_at_sale when it's still null, so re-runs after a webhook
  // retry don't change the frozen cost.
  if (!fulfillRes?.already_fulfilled) {
    const { data: items } = await admin
      .from("order_items")
      .select("id, variant_id, unit_cost_at_sale")
      .eq("order_id", parsed.data.orderId)
      .is("unit_cost_at_sale", null);
    for (const item of (items ?? []) as Array<{
      id: string;
      variant_id: string | null;
      unit_cost_at_sale: number | null;
    }>) {
      if (!item.variant_id) continue;
      // STRICT currency mode — pass the order's currency so the WAC
      // function refuses to synthesize a misleading cost from
      // foreign-currency lots. order_items row stays unit_cost_at_sale
      // = null on mismatch; margin reports surface the gap.
      const wac = await getWeightedAverageCost(item.variant_id, row.currency);
      if (wac && !("reason" in wac)) {
        await admin
          .from("order_items")
          .update({
            unit_cost_at_sale: wac.avg_cost,
            unit_cost_at_sale_currency: wac.currency,
          })
          .eq("id", item.id);
      }
    }
  }

  // Notify customer — prefer the live customer email, fall back to the
  // snapshot taken at order time.
  const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;
  const email = customer?.email ?? row.customer_email_at_order ?? null;
  if (email) {
    await sendEmail({
      to: email,
      subject: `Παραγγελία ${row.order_number} — Επεξεργασία`,
      text: "Η παραγγελία σας προετοιμάζεται για αποστολή.",
      templateId: "order.preparing",
    });
  }

  await logAuditEvent({
    actor_type: "system",
    action: "order.fulfilled",
    resource_type: "order",
    resource_id: parsed.data.orderId,
  });

  return ok({ orderId: parsed.data.orderId });
}
