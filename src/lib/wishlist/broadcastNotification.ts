import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

interface BroadcastArgs {
  customer_id: string;
  variant_id: string;
  product_name: string;
  product_url: string;
  /** ISO expiry of the just-granted 30-min priority hold. Client uses it
   *  to render a live countdown alongside the toast. */
  hold_expires_at: string;
  /** True when the dispatcher sent a custom admin message. */
  custom_message: boolean;
}

/**
 * Phase 6.5 — Realtime customer broadcast on wishlist notification fire.
 *
 * Pushes a transient broadcast message to `customer:{customer_id}` so the
 * customer's open /wishlist page (or any other surface subscribed to the
 * channel) can show a "your item is back" banner immediately — before the
 * email even arrives. The email remains the durable delivery channel; the
 * broadcast is the live UX gravy.
 *
 * Authorization (Phase 10 H2 fix): channel is created with `private: true`
 * so the broadcast is routed through Realtime Authorization. The RLS
 * policy in 20260531000001_realtime_customer_channel_authorization.sql
 * restricts subscribers to the specific customer whose JWT `sub` resolves
 * to the channel's customer_id. Service-role admin client (here) bypasses
 * RLS for publishing, so sends always succeed.
 *
 * Fire-and-forget: errors are logged but never thrown, so a broadcast
 * failure cannot retroactively undo the priority hold + flag clear that
 * already succeeded server-side.
 */
export async function broadcastWishlistNotification(
  args: BroadcastArgs
): Promise<void> {
  try {
    const supabase = createAdminClient();
    const channel = supabase.channel(`customer:${args.customer_id}`, {
      config: { private: true },
    });
    await channel.send({
      type: "broadcast",
      event: "wishlist_notification_fired",
      payload: {
        variant_id: args.variant_id,
        product_name: args.product_name,
        product_url: args.product_url,
        hold_expires_at: args.hold_expires_at,
        custom_message: args.custom_message,
      },
    });
    // Channels opened for transient sends should be closed so they don't
    // accumulate. removeChannel() is idempotent and safe.
    await supabase.removeChannel(channel);
  } catch (err) {
    console.error(
      `[broadcastWishlistNotification] broadcast failed for customer ${args.customer_id}: ${(err as Error).message}`
    );
  }
}
