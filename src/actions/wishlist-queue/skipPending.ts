"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission, requireMFA } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  pending_id: z.string().uuid(),
});

/**
 * Phase 7 admin action — drops one pending notification from the cycle
 * without firing. The wishlist row is untouched, so the customer will be
 * eligible for the next inventory release event for this variant.
 */
export async function skipPending(
  input: z.input<typeof Schema>
): Promise<Result<{ skipped: boolean }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ skipped: boolean }>(parsed.error.issues[0].message, "INVALID_INPUT");
  }

  await requirePermission("manage:wishlist_queue");
  await requireMFA();

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<{ skipped: boolean }>("Δεν είστε συνδεδεμένοι.", "UNAUTHENTICATED");
  }
  const adminUserId = authData.user.id;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("pending_wishlist_notifications")
    .update({
      status: "skipped",
      admin_action_by: adminUserId,
      admin_action_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.pending_id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) return fail<{ skipped: boolean }>(error.message, error.code);
  if (!data) {
    return fail<{ skipped: boolean }>(
      "Η εγγραφή έχει ήδη υποστεί ενέργεια ή δεν βρέθηκε.",
      "ALREADY_RESOLVED"
    );
  }

  await logAuditEvent({
    actor_id: adminUserId,
    actor_type: "user",
    action: "wishlist_queue.skipped",
    resource_type: "pending_wishlist_notification",
    resource_id: parsed.data.pending_id,
  });

  revalidatePath("/admin/wishlist-queue");
  return ok({ skipped: true });
}
