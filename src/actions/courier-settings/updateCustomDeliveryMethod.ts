"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const BaseMethodSchema = z.enum([
  "home_delivery",
  "store_pickup",
  "delivery_station_pickup",
  "carrier_pickup",
]);

const Schema = z.object({
  slug: z.string().max(80),
  display_name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  base_method: BaseMethodSchema.optional(),
  /** Pass null to clear carrier scope, undefined to leave unchanged. */
  carrier_slug: z.string().trim().max(50).nullable().optional(),
});

/**
 * Updates a custom delivery method's editable fields. Slug + is_active are
 * not updated here; is_active is toggled via toggleCustomDeliveryMethodActive
 * for the quick visibility flip.
 *
 * Permission: manage:couriers.
 */
export async function updateCustomDeliveryMethod(
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
    .select("id, slug")
    .eq("slug", parsed.data.slug)
    .maybeSingle();
  if (!existing) {
    return fail<{ slug: string }>("Ο τρόπος παράδοσης δεν βρέθηκε.", "NOT_FOUND");
  }
  const row = existing as { id: string; slug: string };

  const update: Record<string, unknown> = {};
  if (parsed.data.display_name !== undefined) update.display_name = parsed.data.display_name;
  if (parsed.data.description !== undefined) {
    update.description = parsed.data.description?.trim() || null;
  }
  if (parsed.data.base_method !== undefined) update.base_method = parsed.data.base_method;
  if (parsed.data.carrier_slug !== undefined) {
    update.carrier_slug = parsed.data.carrier_slug?.trim() || null;
  }
  if (Object.keys(update).length === 0) {
    return ok({ slug: row.slug });
  }
  update.updated_at = new Date().toISOString();

  const { error } = await admin
    .from("custom_delivery_methods")
    .update(update)
    .eq("id", row.id);
  if (error) {
    return fail<{ slug: string }>(error.message, "DB_ERROR");
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "custom_delivery_method.updated",
    resource_type: "custom_delivery_method",
    resource_id: row.id,
    metadata: { slug: row.slug, changes: update },
  });

  revalidatePath("/admin/settings/couriers");
  updateTag(CACHE_TAGS.COURIERS);
  return ok({ slug: row.slug });
}
