"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission, requireMFA } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  mode: z.enum(["automated", "manual"]),
});

/**
 * Phase 7 admin action — toggles the merchant's wishlist notification
 * mode. Future inventory release events read this setting to decide
 * whether to fire emails directly (automated) or enqueue rows for admin
 * review (manual). In-flight pending rows are not affected.
 */
export async function updateNotificationMode(
  input: z.input<typeof Schema>
): Promise<Result<{ mode: "automated" | "manual" }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ mode: "automated" | "manual" }>(
      parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }

  await requirePermission("manage:wishlist_queue");
  await requireMFA();

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<{ mode: "automated" | "manual" }>(
      "Δεν είστε συνδεδεμένοι.",
      "UNAUTHENTICATED"
    );
  }

  const admin = createAdminClient();
  // Update the most-recent row (the canonical single-row settings store).
  const { data: existing } = await admin
    .from("notification_settings")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    const { error } = await admin
      .from("notification_settings")
      .update({
        wishlist_notification_mode: parsed.data.mode,
        updated_at: new Date().toISOString(),
        updated_by: authData.user.id,
      })
      .eq("id", (existing as { id: string }).id);
    if (error) {
      return fail<{ mode: "automated" | "manual" }>(error.message, error.code);
    }
  } else {
    const { error } = await admin.from("notification_settings").insert({
      wishlist_notification_mode: parsed.data.mode,
      updated_by: authData.user.id,
    });
    if (error) {
      return fail<{ mode: "automated" | "manual" }>(error.message, error.code);
    }
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "wishlist_queue.mode_updated",
    resource_type: "notification_settings",
    resource_id: existing
      ? (existing as { id: string }).id
      : "(new)",
    metadata: { mode: parsed.data.mode },
  });

  revalidatePath("/admin/wishlist-queue");
  return ok({ mode: parsed.data.mode });
}
