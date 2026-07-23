"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  slug: z.string().max(80),
  is_active: z.boolean(),
});

/**
 * Flips a custom delivery method's checkout visibility. Independent of the
 * scoped carrier's is_active — deactivating the method hides it even if
 * the carrier is still active, and vice versa.
 *
 * Permission: manage:couriers.
 */
export async function toggleCustomDeliveryMethodActive(
  input: z.input<typeof Schema>
): Promise<Result<{ slug: string; is_active: boolean }>> {
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
    .select("id, slug, is_active")
    .eq("slug", parsed.data.slug)
    .maybeSingle();
  if (!existing) {
    return fail<{ slug: string; is_active: boolean }>(
      "Ο τρόπος παράδοσης δεν βρέθηκε.",
      "NOT_FOUND"
    );
  }
  const row = existing as { id: string; slug: string; is_active: boolean };

  if (row.is_active === parsed.data.is_active) {
    return ok({ slug: row.slug, is_active: row.is_active });
  }

  const { error } = await admin
    .from("custom_delivery_methods")
    .update({
      is_active: parsed.data.is_active,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (error) {
    return fail<{ slug: string; is_active: boolean }>(error.message, "DB_ERROR");
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: parsed.data.is_active
      ? "custom_delivery_method.activated"
      : "custom_delivery_method.deactivated",
    resource_type: "custom_delivery_method",
    resource_id: row.id,
    metadata: { slug: row.slug, previous_is_active: row.is_active },
  });

  revalidatePath("/admin/settings/couriers");
  updateTag(CACHE_TAGS.COURIERS);
  return ok({ slug: row.slug, is_active: parsed.data.is_active });
}
