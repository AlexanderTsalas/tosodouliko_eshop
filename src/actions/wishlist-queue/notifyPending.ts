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
  pending_id: z.string().uuid(),
  /** Optional admin-composed message to substitute for the template body. */
  admin_message: z.string().max(2000).optional(),
});

interface NotifyResult {
  priority_hold_id: string;
  email_sent: boolean;
}

/**
 * Phase 7 admin action — fires the wishlist notification for one pending
 * row. Engages the 30-min priority hold, sends the email, marks the
 * pending row `status='notified'` with the admin's user_id + timestamp.
 *
 * Idempotency: if the row is already in a terminal status (notified /
 * skipped / expired), returns ok with no-op semantics.
 */
export async function notifyPending(
  input: z.input<typeof Schema>
): Promise<Result<NotifyResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<NotifyResult>(parsed.error.issues[0].message, "INVALID_INPUT");
  }

  await requirePermission("manage:wishlist_queue");
  await requireMFA();

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<NotifyResult>("Δεν είστε συνδεδεμένοι.", "UNAUTHENTICATED");
  }
  const adminUserId = authData.user.id;

  const admin = createAdminClient();
  const { data: pendingRow } = await admin
    .from("pending_wishlist_notifications")
    .select(
      "id, wishlist_item_id, variant_id, customer_id, quantity_to_offer, triggered_by, status"
    )
    .eq("id", parsed.data.pending_id)
    .maybeSingle();
  const pending = pendingRow as
    | {
        id: string;
        wishlist_item_id: string;
        variant_id: string;
        customer_id: string;
        quantity_to_offer: number;
        triggered_by: string;
        status: string;
      }
    | null;
  if (!pending) {
    return fail<NotifyResult>("Δεν βρέθηκε η εγγραφή.", "NOT_FOUND");
  }
  if (pending.status !== "pending") {
    return fail<NotifyResult>(
      "Η εγγραφή έχει ήδη υποστεί ενέργεια.",
      "ALREADY_RESOLVED"
    );
  }

  const fire = await fireWishlistNotification({
    wishlist_item_id: pending.wishlist_item_id,
    variant_id: pending.variant_id,
    customer_id: pending.customer_id,
    quantity_to_hold: pending.quantity_to_offer,
    triggered_by: pending.triggered_by as never,
    admin_message: parsed.data.admin_message ?? null,
  });
  if (!fire.success) {
    return fail<NotifyResult>(
      fire.error_message ?? "Notify failed",
      fire.reason ?? "FIRE_FAILED"
    );
  }

  await admin
    .from("pending_wishlist_notifications")
    .update({
      status: "notified",
      admin_action_by: adminUserId,
      admin_action_at: new Date().toISOString(),
      admin_message: parsed.data.admin_message ?? null,
    })
    .eq("id", pending.id);

  await logAuditEvent({
    actor_id: adminUserId,
    actor_type: "user",
    action: "wishlist_queue.notified",
    resource_type: "pending_wishlist_notification",
    resource_id: pending.id,
    metadata: {
      variant_id: pending.variant_id,
      customer_id: pending.customer_id,
      has_custom_message: !!parsed.data.admin_message,
    },
  });

  revalidatePath("/admin/wishlist-queue");
  return ok({
    priority_hold_id: fire.priority_hold_id!,
    email_sent: fire.reason !== "EMAIL_FAILED",
  });
}
