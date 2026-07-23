import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

interface ReleaseArgs {
  customer_id: string;
  /** When supplied, only releases holds for this variant. Otherwise sweeps
   *  every active hold in the customer's name. */
  variant_id?: string;
}

/**
 * Phase 10 §16.2 / §16.3 / §16.6 helper — release any active priority
 * hold(s) belonging to a customer.
 *
 * Used by:
 *   - removeFromCart (cart item with priority hold gets removed)
 *   - updateCartItem (qty reduced below hold quantity)
 *   - removeWishlistItem (subscriber deletes a wishlist entry whose
 *     notification fired and engaged a hold they no longer want)
 *   - signOut sweep (sign-out is cancel-everything per spec §16.6)
 *
 * For soft_wait_promotion-source holds, this immediately invokes
 * `advance_soft_wait_queue_after_priority_expiry` so the next FIFO waiter
 * gets their turn without waiting for the periodic reaper.
 *
 * For wishlist_notification-source holds, the periodic
 * `tickleWishlistDispatcher` cron will pick up the freed inventory and
 * promote the next wishlist subscriber.
 *
 * Best-effort: errors are logged but never thrown. Returns the count of
 * holds successfully released so callers can surface it.
 */
export async function releaseCustomerPriorityHolds(
  args: ReleaseArgs
): Promise<{ released: number }> {
  const admin = createAdminClient();

  let query = admin
    .from("priority_holds")
    .select("id, variant_id, quantity, source")
    .eq("customer_id", args.customer_id)
    .is("consumed_at", null);
  if (args.variant_id) query = query.eq("variant_id", args.variant_id);
  const { data: holdRows } = await query;
  const holds = (holdRows ?? []) as Array<{
    id: string;
    variant_id: string;
    quantity: number;
    source: "soft_wait_promotion" | "wishlist_notification";
  }>;
  if (holds.length === 0) return { released: 0 };

  let released = 0;
  const nowIso = new Date().toISOString();
  for (const hold of holds) {
    const { error: rpcErr } = await admin.rpc("release_priority" as never, {
      p_variant_id: hold.variant_id,
      p_qty: hold.quantity,
    } as never);
    if (rpcErr) {
      console.error(
        `[releaseCustomerPriorityHolds] release_priority failed for hold ${hold.id}: ${rpcErr.message}`
      );
      continue;
    }
    await admin
      .from("priority_holds")
      .update({ consumed_at: nowIso, expires_at: nowIso })
      .eq("id", hold.id);
    released += 1;

    if (hold.source === "soft_wait_promotion") {
      const { error: advanceErr } = await admin.rpc(
        "advance_soft_wait_queue_after_priority_expiry" as never,
        { p_priority_hold_id: hold.id } as never
      );
      if (advanceErr) {
        console.error(
          `[releaseCustomerPriorityHolds] queue advance failed for hold ${hold.id}: ${advanceErr.message}`
        );
      }
    }
  }
  return { released };
}
