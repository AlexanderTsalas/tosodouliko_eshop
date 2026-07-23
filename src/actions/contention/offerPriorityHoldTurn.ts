"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  priority_hold_id: z.string().uuid(),
});

/**
 * Waiter (currently holding a soft_wait_promotion priority_hold) voluntarily
 * releases their turn. Mirrors the cron-driven "priority hold expired"
 * pathway: releases the inventory back to available and advances the queue
 * to the next FIFO waiter in the same (origin_session, variant) bucket.
 *
 * Idempotent: if the hold has already been consumed/released, a no-op.
 */
export async function offerPriorityHoldTurn(
  input: z.input<typeof Schema>
): Promise<Result<{ released: boolean; next_promoted: boolean }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ released: boolean; next_promoted: boolean }>(
      "Invalid input",
      "INVALID_INPUT"
    );
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<{ released: boolean; next_promoted: boolean }>(
      "Not authenticated",
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
    return fail<{ released: boolean; next_promoted: boolean }>(
      "Missing customer profile",
      "NO_CUSTOMER"
    );
  }

  // Ownership + idempotency: this customer must own the hold AND it must
  // still be active (not consumed).
  const { data: holdRow } = await admin
    .from("priority_holds")
    .select("id, customer_id, variant_id, quantity, consumed_at, source")
    .eq("id", parsed.data.priority_hold_id)
    .maybeSingle();
  const hold = holdRow as {
    id: string;
    customer_id: string;
    variant_id: string;
    quantity: number;
    consumed_at: string | null;
    source: string;
  } | null;
  if (!hold || hold.customer_id !== customerId) {
    return fail<{ released: boolean; next_promoted: boolean }>(
      "Hold not found",
      "NOT_FOUND"
    );
  }
  if (hold.consumed_at) {
    return ok({ released: false, next_promoted: false });
  }

  // Release the inventory back to available.
  try {
    await admin.rpc("release_priority" as never, {
      p_variant_id: hold.variant_id,
      p_qty: hold.quantity,
    } as never);
  } catch {
    // INSUFFICIENT_PRIORITY_HELD or race — benign.
  }

  // Mark the hold consumed so it stops blocking anything downstream.
  await admin
    .from("priority_holds")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", hold.id);

  // Promote the next FIFO waiter in the same (session, variant) bucket.
  let nextPromoted = false;
  try {
    const { data: advanced } = await admin.rpc(
      "advance_soft_wait_queue_after_priority_expiry" as never,
      { p_priority_hold_id: hold.id } as never
    );
    nextPromoted = Boolean(advanced);
  } catch (err) {
    console.error(
      `[offerPriorityHoldTurn] advance failed for hold ${hold.id}:`,
      err
    );
  }

  await logAuditEvent({
    actor_id: userId,
    actor_type: "user",
    action: "priority_hold.offered_turn",
    resource_type: "priority_hold",
    resource_id: hold.id,
    metadata: {
      variant_id: hold.variant_id,
      quantity: hold.quantity,
      next_promoted: nextPromoted,
    },
  });

  revalidatePath("/cart");
  revalidatePath("/checkout");
  return ok({ released: true, next_promoted: nextPromoted });
}
