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
  slug: z.string().max(50),
});

/**
 * Phase 9 — deletes a custom carrier. Refuses to delete built-in carriers
 * (those should be deactivated via is_active=false instead).
 *
 * Deletion fails if any orders reference the carrier (orders.carrier_slug
 * and carrier_provider_configs.carrier both use ON DELETE RESTRICT). The
 * action surfaces the FK error verbatim so the admin sees a clear "still
 * referenced by N orders" message rather than a generic database error.
 *
 * orders.pickup_carrier uses ON DELETE SET NULL — pickup history is lost
 * on deletion, but historical orders themselves stay intact.
 *
 * Permission: manage:couriers.
 */
export async function deleteCustomCarrier(
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
    .from("delivery_carriers")
    .select("id, slug, is_custom, display_name")
    .eq("slug", parsed.data.slug)
    .maybeSingle();
  if (!existing) return fail<{ slug: string }>("Η μεταφορική δεν βρέθηκε.", "NOT_FOUND");
  const row = existing as {
    id: string;
    slug: string;
    is_custom: boolean;
    display_name: string;
  };

  if (!row.is_custom) {
    return fail<{ slug: string }>(
      "Οι built-in μεταφορικές δεν διαγράφονται. Απενεργοποιήστε τις με το toggle.",
      "BUILTIN_NOT_DELETABLE"
    );
  }

  const { error } = await admin
    .from("delivery_carriers")
    .delete()
    .eq("id", row.id);
  if (error) {
    // The most common failure is FK violation when historical orders still
    // reference this carrier — surface the DB message so the admin sees
    // exactly why.
    return fail<{ slug: string }>(
      error.message.includes("foreign key")
        ? "Δεν είναι δυνατή η διαγραφή — η μεταφορική χρησιμοποιείται σε υπάρχουσες παραγγελίες."
        : error.message,
      "DB_ERROR"
    );
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "courier.custom_deleted",
    resource_type: "delivery_carrier",
    resource_id: row.id,
    metadata: { slug: row.slug, display_name: row.display_name },
  });

  revalidatePath("/admin/settings/couriers");
  updateTag(CACHE_TAGS.COURIERS);

  return ok({ slug: row.slug });
}
