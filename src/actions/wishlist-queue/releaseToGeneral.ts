"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission, requireMFA } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  variant_id: z.string().uuid(),
});

/**
 * Phase 7 admin action — drops the entire pending queue for a variant
 * without notifying anyone. Inventory becomes immediately available to
 * fresh customers (it already is, since wishlist is contact-list not
 * lock — see spec §11.3 — but the pending rows go away so the admin
 * view is clean).
 *
 * The customers' wishlist entries are NOT removed; they stay eligible
 * for the next inventory release event.
 */
export async function releaseToGeneral(
  input: z.input<typeof Schema>
): Promise<Result<{ released: number }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ released: number }>(parsed.error.issues[0].message, "INVALID_INPUT");
  }

  await requirePermission("manage:wishlist_queue");
  await requireMFA();

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<{ released: number }>("Δεν είστε συνδεδεμένοι.", "UNAUTHENTICATED");
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
    .eq("variant_id", parsed.data.variant_id)
    .eq("status", "pending")
    .select("id");
  if (error) return fail<{ released: number }>(error.message, error.code);
  const releasedCount = (data ?? []).length;

  await logAuditEvent({
    actor_id: adminUserId,
    actor_type: "user",
    action: "wishlist_queue.released_to_general",
    resource_type: "product_variant",
    resource_id: parsed.data.variant_id,
    metadata: { released_count: releasedCount },
  });

  revalidatePath("/admin/wishlist-queue");
  return ok({ released: releasedCount });
}
