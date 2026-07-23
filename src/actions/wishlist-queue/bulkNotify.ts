"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission, requireMFA } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fireWishlistNotification } from "@/lib/wishlist/fireWishlistNotification";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  /** Limit the bulk fire to one variant. Caller picks; UI groups by variant
   *  so this is the natural input. */
  variant_id: z.string().uuid(),
});

interface BulkResult {
  attempted: number;
  notified: number;
  skipped: number;
  /** Sample failure messages for the toast / surface. */
  errors: string[];
}

/**
 * Phase 7 admin action — fires ALL pending notifications for a single
 * variant in one wave. Sequential ~1.2s pacing per fire to honor the
 * sendBatch limit; per-send failures don't abort the wave.
 *
 * Inventory cap: if there are more queued subscribers than units
 * available, fires FIFO until inventory runs out and marks the rest
 * `status='skipped'` with an audit note. The skipped subscribers keep
 * their wishlist_items.notify_on_restock=true so they're eligible for
 * the next release event.
 */
export async function bulkNotify(
  input: z.input<typeof Schema>
): Promise<Result<BulkResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<BulkResult>(parsed.error.issues[0].message, "INVALID_INPUT");
  }

  await requirePermission("manage:wishlist_queue");
  await requireMFA();

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<BulkResult>("Δεν είστε συνδεδεμένοι.", "UNAUTHENTICATED");
  }
  const adminUserId = authData.user.id;

  const admin = createAdminClient();
  const { data: pendingRows } = await admin
    .from("pending_wishlist_notifications")
    .select(
      "id, wishlist_item_id, variant_id, customer_id, quantity_to_offer, triggered_by"
    )
    .eq("variant_id", parsed.data.variant_id)
    .eq("status", "pending")
    .order("triggered_at", { ascending: true });
  const pending = (pendingRows ?? []) as Array<{
    id: string;
    wishlist_item_id: string;
    variant_id: string;
    customer_id: string;
    quantity_to_offer: number;
    triggered_by: string;
  }>;
  if (pending.length === 0) {
    return ok({ attempted: 0, notified: 0, skipped: 0, errors: [] });
  }

  const result: BulkResult = {
    attempted: pending.length,
    notified: 0,
    skipped: 0,
    errors: [],
  };
  const nowIso = new Date().toISOString();

  for (let i = 0; i < pending.length; i += 1) {
    const row = pending[i];
    const fire = await fireWishlistNotification({
      wishlist_item_id: row.wishlist_item_id,
      variant_id: row.variant_id,
      customer_id: row.customer_id,
      quantity_to_hold: row.quantity_to_offer,
      triggered_by: row.triggered_by as never,
    });

    if (fire.success) {
      result.notified += 1;
      await admin
        .from("pending_wishlist_notifications")
        .update({
          status: "notified",
          admin_action_by: adminUserId,
          admin_action_at: nowIso,
        })
        .eq("id", row.id);
    } else if (fire.reason === "INSUFFICIENT_INVENTORY") {
      // Out of stock from this point forward. Mark this + any remaining
      // rows as skipped so the queue doesn't show stale entries.
      const remainingIds = pending.slice(i).map((r) => r.id);
      await admin
        .from("pending_wishlist_notifications")
        .update({
          status: "skipped",
          admin_action_by: adminUserId,
          admin_action_at: nowIso,
        })
        .in("id", remainingIds);
      result.skipped += remainingIds.length;
      break;
    } else {
      result.skipped += 1;
      if (result.errors.length < 5) {
        result.errors.push(fire.error_message ?? fire.reason ?? "unknown");
      }
      await admin
        .from("pending_wishlist_notifications")
        .update({
          status: "skipped",
          admin_action_by: adminUserId,
          admin_action_at: nowIso,
        })
        .eq("id", row.id);
    }

    if (i < pending.length - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1200));
    }
  }

  await logAuditEvent({
    actor_id: adminUserId,
    actor_type: "user",
    action: "wishlist_queue.bulk_notified",
    resource_type: "product_variant",
    resource_id: parsed.data.variant_id,
    metadata: {
      attempted: result.attempted,
      notified: result.notified,
      skipped: result.skipped,
    },
  });

  revalidatePath("/admin/wishlist-queue");
  return ok(result);
}
