"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  orderId: z.string().uuid(),
});

interface DeleteResult {
  order_id: string;
  order_number: string;
  inventory_action: "released" | "restored" | "released_with_drift" | "none";
  /** When `inventory_action = released_with_drift`, lists the variants
   *  where `quantity_reserved` was below the order item quantity and
   *  the action fell back to a non-strict restore. Surfaced so the
   *  admin can investigate the drift (most likely cause: someone
   *  hand-edited the `Held` inventory cell). */
  drift?: Array<{ variant_id: string; qty: number }>;
}

/**
 * Hard-deletes an order and (via cascade) its order_items. This is distinct
 * from cancellation: cancellation preserves the audit trail; deletion removes
 * the row entirely. Intended for drafts, mistakes, test orders, or cleaned-up
 * cancelled/refunded orders that the admin doesn't want lingering in lists.
 *
 * Safety rules:
 *
 *  - REFUSED for paid Stripe orders that haven't been refunded yet — the
 *    money trail must close first. The admin should call refundOrder() and
 *    then retry deletion.
 *  - REFUSED for orders past 'preparing' (shipped / ready_for_pickup /
 *    delivered / picked_up) that aren't cancelled or refunded — items have
 *    physically moved and we shouldn't lose the record.
 *  - For reserved inventory still in the pipeline (non-Stripe pre-shipment),
 *    release_reservation is called for each item before delete.
 *  - For decremented inventory pre-shipment (Stripe pre-payment edge),
 *    restore_inventory is called.
 *  - Cancelled and refunded orders have already had their inventory restored
 *    by the relevant transition; deletion is a no-op inventory-wise.
 *
 * Note that delete is not reversible by undo. The caller must surface a
 * confirmation prompt.
 */
export async function deleteOrder(
  input: z.input<typeof Schema>
): Promise<Result<DeleteResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<DeleteResult>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:orders"))) {
    return fail<DeleteResult>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<DeleteResult>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();

  const { data: orderRow, error: fetchErr } = await admin
    .from("orders")
    .select(
      "id, order_number, payment_method, payment_status, fulfillment_status, total"
    )
    .eq("id", parsed.data.orderId)
    .maybeSingle();

  if (fetchErr) return fail<DeleteResult>(fetchErr.message, fetchErr.code);
  if (!orderRow) return fail<DeleteResult>("Order not found", "NOT_FOUND");

  const order = orderRow as {
    id: string;
    order_number: string;
    payment_method: "stripe" | "cod" | "cash_on_pickup" | "bank_transfer";
    payment_status: "pending" | "paid" | "refunded" | "failed";
    fulfillment_status:
      | "draft"
      | "pending"
      | "confirmed"
      | "preparing"
      | "shipped"
      | "ready_for_pickup"
      | "delivered"
      | "picked_up"
      | "cancelled";
    total: number;
  };

  // ---- Safety gates --------------------------------------------------------

  // Refuse if Stripe-paid and not refunded. Money trail must close first.
  if (
    order.payment_method === "stripe" &&
    order.payment_status === "paid" &&
    order.fulfillment_status !== "cancelled"
  ) {
    return fail<DeleteResult>(
      "Δεν επιτρέπεται διαγραφή πληρωμένης παραγγελίας Stripe. Κάντε πρώτα επιστροφή χρημάτων (refund) και ξαναπροσπαθήστε.",
      "REFUND_REQUIRED"
    );
  }

  // Refuse if items have physically left and the order is not closed out.
  const shipmentLikeStates = ["shipped", "ready_for_pickup", "delivered", "picked_up"];
  if (
    shipmentLikeStates.includes(order.fulfillment_status) &&
    order.payment_status !== "refunded"
  ) {
    return fail<DeleteResult>(
      `Δεν επιτρέπεται διαγραφή παραγγελίας σε κατάσταση "${order.fulfillment_status}". Ακυρώστε ή κάντε refund πρώτα.`,
      "BAD_STATE"
    );
  }

  // ---- Atomic delete: inventory reversal + audit log + DELETE ------------
  // All state changes happen inside ONE Postgres transaction via
  // delete_order_safe. If anything fails the whole batch rolls back —
  // no more "items 1-3 released, items 4-6 not, order still exists"
  // partial state.
  const { data: rpcRes, error: rpcErr } = await admin.rpc(
    "delete_order_safe" as never,
    {
      p_order_id: order.id,
      p_actor_id: authData.user.id,
    } as never
  );

  if (rpcErr) {
    if (rpcErr.message?.includes("ORDER_NOT_FOUND")) {
      return fail<DeleteResult>("Order not found", "NOT_FOUND");
    }
    if (rpcErr.message?.includes("INVENTORY_NOT_FOUND")) {
      return fail<DeleteResult>(
        `Αποτυχία επαναφοράς αποθέματος: ${rpcErr.message}. Η παραγγελία δεν διαγράφηκε.`,
        rpcErr.code
      );
    }
    return fail<DeleteResult>(
      `Σφάλμα διαγραφής: ${rpcErr.message}. Η παραγγελία δεν διαγράφηκε.`,
      rpcErr.code
    );
  }

  const res = (rpcRes ?? null) as {
    ok: boolean;
    order_id: string;
    order_number: string;
    inventory_action: DeleteResult["inventory_action"];
    drift: Array<{ variant_id: string; qty: number }> | null;
  } | null;

  if (!res) {
    return fail<DeleteResult>("Empty response from delete_order_safe", "RPC_EMPTY");
  }

  revalidatePath("/admin/orders");
  revalidatePath("/admin/inventory");
  return ok({
    order_id: res.order_id,
    order_number: res.order_number,
    inventory_action: res.inventory_action,
    ...(res.drift && res.drift.length > 0 ? { drift: res.drift } : {}),
  });
}
