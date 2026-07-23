"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z
  .object({
    /** Drop by direct soft_wait id (preferred when caller has it). */
    soft_wait_id: z.string().uuid().optional(),
    /** Drop by (variant_id, customer's own active queue entry). Convenience. */
    variant_id: z.string().uuid().optional(),
    /**
     * Whether to also remove the corresponding cart_item. Default true
     * because the spec ties cart_item removal to leaving the queue —
     * "I no longer want this." False is only useful if the caller is
     * removing just the wait but leaving the item (rare).
     */
    remove_cart_item: z.boolean().default(true),
  })
  .refine((v) => v.soft_wait_id || v.variant_id, {
    message: "Must supply either soft_wait_id or variant_id",
  });

export interface LeaveSoftWaitQueueResult {
  released_count: number;
}

/**
 * Phase 4A: leave a soft-wait queue. Used when:
 *  - Customer removes the contested item from their cart while waiting.
 *  - Customer is promoted to a priority_hold and decides not to act —
 *    they can voluntarily release rather than wait the 5-min timeout
 *    (the reaper would still pick it up, but explicit release is faster).
 *
 * If the customer's wait has already been promoted to a priority_hold,
 * the hold is released and the queue advances inline so the next waiter
 * gets their turn immediately.
 */
export async function leaveSoftWaitQueue(
  input: z.input<typeof Schema>
): Promise<Result<LeaveSoftWaitQueueResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<LeaveSoftWaitQueueResult>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<LeaveSoftWaitQueueResult>(
      "Συνδεθείτε για να αποχωρήσετε από τη λίστα αναμονής.",
      "UNAUTHENTICATED"
    );
  }
  const userId = authData.user.id;
  const admin = createAdminClient();

  const { data: custRow } = await admin
    .from("customers")
    .select("id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  const customerId = (custRow as { id: string } | null)?.id ?? null;
  if (!customerId) {
    return fail<LeaveSoftWaitQueueResult>("Λείπει το προφίλ πελάτη.", "NO_CUSTOMER");
  }

  // Resolve which soft_waits to drop. Either by explicit id or by
  // (customer, variant) — multiple matches possible if the customer joined
  // queues for the same variant across multiple sessions.
  type WaitRow = {
    id: string;
    cart_item_id: string;
    variant_id: string;
    quantity: number;
    promoted_at: string | null;
    checkout_session_id: string;
  };
  let waits: WaitRow[] = [];
  if (parsed.data.soft_wait_id) {
    const { data } = await admin
      .from("soft_waits")
      .select("id, cart_item_id, variant_id, quantity, promoted_at, checkout_session_id")
      .eq("id", parsed.data.soft_wait_id)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (data) waits = [data as WaitRow];
  } else if (parsed.data.variant_id) {
    const { data } = await admin
      .from("soft_waits")
      .select("id, cart_item_id, variant_id, quantity, promoted_at, checkout_session_id")
      .eq("customer_id", customerId)
      .eq("variant_id", parsed.data.variant_id);
    waits = (data ?? []) as WaitRow[];
  }
  if (waits.length === 0) {
    return ok({ released_count: 0 });
  }

  let releasedCount = 0;
  for (const wait of waits) {
    // If this wait was already promoted, release the priority_hold first
    // (inventory back to available + queue advances).
    if (wait.promoted_at) {
      const { data: holdRow } = await admin
        .from("priority_holds")
        .select("id, variant_id, quantity")
        .eq("origin_soft_wait_id", wait.id)
        .is("consumed_at", null)
        .maybeSingle();
      if (holdRow) {
        const hold = holdRow as { id: string; variant_id: string; quantity: number };
        await admin.rpc("release_priority" as never, {
          p_variant_id: hold.variant_id,
          p_qty: hold.quantity,
        } as never);
        await admin
          .from("priority_holds")
          .update({ consumed_at: new Date().toISOString() })
          .eq("id", hold.id);
        // Trigger queue advance for the next FIFO waiter behind this one.
        await admin.rpc(
          "advance_soft_wait_queue_after_priority_expiry" as never,
          { p_priority_hold_id: hold.id } as never
        );
      }
    }

    if (parsed.data.remove_cart_item) {
      await admin.from("cart_items").delete().eq("id", wait.cart_item_id);
    }
    // The soft_waits row is removed via CASCADE on cart_items (FK above);
    // but if the caller chose to keep the cart_item we delete the wait
    // explicitly so the customer isn't double-charged a queue position.
    await admin.from("soft_waits").delete().eq("id", wait.id);

    // Recompute the holder's contention timer — if this was the last waiter
    // behind the session, expires_at is cleared (uncontended again).
    await admin.rpc("apply_contention_timer" as never, {
      p_session_id: wait.checkout_session_id,
    } as never);

    releasedCount += 1;
  }

  await logAuditEvent({
    actor_id: userId,
    actor_type: "user",
    action: "cart.soft_wait_left",
    resource_type: "soft_wait",
    resource_id: waits.map((w) => w.id).join(","),
    metadata: {
      released_count: releasedCount,
      remove_cart_item: parsed.data.remove_cart_item,
    },
  });

  revalidatePath("/cart");
  return ok({ released_count: releasedCount });
}
