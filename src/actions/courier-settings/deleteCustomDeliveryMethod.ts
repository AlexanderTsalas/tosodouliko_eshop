"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ slug: z.string().max(80) });

/**
 * Deletes a custom delivery method. orders.custom_delivery_method_slug FK
 * is ON DELETE SET NULL, so historical orders survive but lose the
 * reference (the order's delivery_method column still holds the base
 * value so fulfillment / reporting still works).
 *
 * Permission: manage:couriers.
 */
export async function deleteCustomDeliveryMethod(
  input: z.input<typeof Schema>
): Promise<Result<{ slug: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail("Συνδεθείτε για να συνεχίσετε.", "UNAUTHENTICATED");
  if (!(await checkPermission("manage:couriers"))) {
    return fail("Δεν έχετε δικαίωμα διαχείρισης μεταφορικών.", "FORBIDDEN");
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("custom_delivery_methods")
    .select("id, slug, display_name")
    .eq("slug", parsed.data.slug)
    .maybeSingle();
  if (!existing) {
    return fail<{ slug: string }>(
      "Ο τρόπος παράδοσης δεν βρέθηκε.",
      "NOT_FOUND"
    );
  }
  const row = existing as { id: string; slug: string; display_name: string };

  const { error } = await admin
    .from("custom_delivery_methods")
    .delete()
    .eq("id", row.id);
  if (error) {
    return fail<{ slug: string }>(error.message, "DB_ERROR");
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "custom_delivery_method.deleted",
    resource_type: "custom_delivery_method",
    resource_id: row.id,
    metadata: { slug: row.slug, display_name: row.display_name },
  });

  revalidatePath("/admin/settings/couriers");
  updateTag(CACHE_TAGS.COURIERS);
  return ok({ slug: row.slug });
}
