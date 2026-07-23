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
  is_active: z.boolean(),
});

/**
 * Phase 9 — flips a carrier's visibility on the storefront. Works on both
 * built-in and custom carriers; this is the only path to deactivate a
 * built-in (built-ins can't be deleted).
 *
 * Deactivating a carrier hides it from the checkout's carrier dropdown and
 * from the availableCarriers() compatibility helper. Historical orders that
 * already chose this carrier are unaffected — their carrier_slug column
 * still references the row.
 *
 * Kept separate from updateCarrier so the common "just flip visibility"
 * path doesn't go through the full validation / read-modify-write cycle.
 *
 * Permission: manage:couriers.
 */
export async function toggleCarrierActive(
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
    .from("delivery_carriers")
    .select("id, slug, is_active, is_custom")
    .eq("slug", parsed.data.slug)
    .maybeSingle();
  if (!existing) {
    return fail<{ slug: string; is_active: boolean }>(
      "Η μεταφορική δεν βρέθηκε.",
      "NOT_FOUND"
    );
  }
  const row = existing as {
    id: string;
    slug: string;
    is_active: boolean;
    is_custom: boolean;
  };

  // No-op short-circuit. Avoids an audit-log entry for a click that
  // didn't change anything (e.g. a duplicate request).
  if (row.is_active === parsed.data.is_active) {
    return ok({ slug: row.slug, is_active: row.is_active });
  }

  const { error } = await admin
    .from("delivery_carriers")
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
    action: parsed.data.is_active ? "courier.activated" : "courier.deactivated",
    resource_type: "delivery_carrier",
    resource_id: row.id,
    metadata: {
      slug: row.slug,
      is_custom: row.is_custom,
      previous_is_active: row.is_active,
    },
  });

  revalidatePath("/admin/settings/couriers");
  updateTag(CACHE_TAGS.COURIERS);

  return ok({ slug: row.slug, is_active: parsed.data.is_active });
}
