import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchWishlistNotifications } from "./dispatchNotifications";

interface TickleResult {
  scanned: number;
  variants_dispatched: number;
  total_notified: number;
  total_enqueued: number;
}

/**
 * Phase 6 follow-up — periodic "is anyone waiting?" sweep.
 *
 * Closes two gaps the per-event triggers leave open:
 *
 *  1. Sequential-cadence advancement. When a `wishlist_notification`
 *     priority hold expires unconsumed, `release_expired_priority_holds`
 *     returns the unit to `quantity_available`. The next FIFO wishlist
 *     subscriber should be notified — but that needs TS (email send) so
 *     SQL can't do it inline. This sweep notices the freed inventory
 *     and fires the dispatcher for them.
 *
 *  2. Backstop for inline triggers. If `transitionOrderStatus` or
 *     `setInventoryLevel` dispatches fail (network blip, partial run),
 *     this sweep eventually catches the missed event.
 *
 * Idempotency-safe to run frequently:
 *  - Skips variants with no `notify_on_restock` subscribers.
 *  - Skips variants with `quantity_available <= 0`.
 *  - Skips variants that have an active (not consumed, not expired)
 *    `wishlist_notification` priority hold — the current subscriber is
 *    still inside their 30-min window.
 *
 * Schedule externally (Vercel Cron, pg_cron+pg_net, cron-job.org, etc.)
 * pointed at /api/cron/wishlist-advance every ~1 minute.
 */
export async function tickleWishlistDispatcher(): Promise<TickleResult> {
  const admin = createAdminClient();
  const result: TickleResult = {
    scanned: 0,
    variants_dispatched: 0,
    total_notified: 0,
    total_enqueued: 0,
  };

  // Candidate variants: anyone subscribed via notify_on_restock=true. The
  // set is small enough (low-traffic shop) that distinct selection in
  // SQL is fine.
  const { data: candidates } = await admin
    .from("wishlist_items")
    .select("variant_id")
    .eq("notify_on_restock", true)
    .not("variant_id", "is", null);
  const rows = (candidates ?? []) as Array<{ variant_id: string | null }>;
  const variantIds = Array.from(
    new Set(rows.map((r) => r.variant_id).filter((id): id is string => Boolean(id)))
  );
  result.scanned = variantIds.length;
  if (variantIds.length === 0) return result;

  for (const variantId of variantIds) {
    // Skip if a wishlist priority hold is still active. Other priority
    // sources (soft_wait_promotion) don't block wishlist dispatch — they
    // sit in a separate bucket on the same variant.
    const { data: activeHoldRow } = await admin
      .from("priority_holds")
      .select("id")
      .eq("variant_id", variantId)
      .eq("source", "wishlist_notification")
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .limit(1)
      .maybeSingle();
    if (activeHoldRow) continue;

    const { data: invRow } = await admin
      .from("inventory_items")
      .select("quantity_available")
      .eq("variant_id", variantId)
      .maybeSingle();
    const available = Number(
      (invRow as { quantity_available: number } | null)?.quantity_available ?? 0
    );
    if (available <= 0) continue;

    const r = await dispatchWishlistNotifications({
      variant_id: variantId,
      released_qty: available,
      triggered_by: "priority_hold_expired",
    });

    if (r.notified > 0 || r.enqueued > 0) {
      result.variants_dispatched += 1;
      result.total_notified += r.notified;
      result.total_enqueued += r.enqueued;
    }
  }

  return result;
}
