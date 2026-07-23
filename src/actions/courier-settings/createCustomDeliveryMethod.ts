"use server";

import { z } from "zod";
import { randomBytes } from "crypto";
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
  display_name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  base_method: BaseMethodSchema,
  /** Optional carrier scope. Empty / null = available with any carrier supporting base_method. */
  carrier_slug: z.string().trim().max(50).optional().nullable(),
});

interface CreateResult {
  slug: string;
  id: string;
}

/**
 * Creates a custom delivery method. Slug is auto-generated and opaque
 * (`custom_<random12hex>`); the display_name is what the customer sees.
 * is_active=false by default — admin enables it via the toggle once
 * they're happy with the configuration.
 *
 * Permission: manage:couriers.
 */
export async function createCustomDeliveryMethod(
  input: z.input<typeof Schema>
): Promise<Result<CreateResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<CreateResult>(
      "Συμπληρώστε τα υποχρεωτικά πεδία.",
      "INVALID_INPUT"
    );
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail("Συνδεθείτε για να συνεχίσετε.", "UNAUTHENTICATED");
  if (!(await checkPermission("manage:couriers"))) {
    return fail("Δεν έχετε δικαίωμα διαχείρισης μεταφορικών.", "FORBIDDEN");
  }

  const slug = `custom_${randomBytes(6).toString("hex")}`;

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("custom_delivery_methods")
    .insert({
      slug,
      display_name: parsed.data.display_name,
      description: parsed.data.description?.trim() || null,
      base_method: parsed.data.base_method,
      carrier_slug: parsed.data.carrier_slug?.trim() || null,
      is_active: false,
      display_order: 100,
      created_by: authData.user.id,
    })
    .select("id, slug")
    .single();

  if (error || !row) {
    return fail<CreateResult>(
      error?.message ?? "Σφάλμα δημιουργίας τρόπου παράδοσης.",
      "DB_ERROR"
    );
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "custom_delivery_method.created",
    resource_type: "custom_delivery_method",
    resource_id: (row as { id: string }).id,
    metadata: {
      slug,
      display_name: parsed.data.display_name,
      base_method: parsed.data.base_method,
      carrier_slug: parsed.data.carrier_slug ?? null,
    },
  });

  revalidatePath("/admin/settings/couriers");
  updateTag(CACHE_TAGS.COURIERS);
  return ok({ slug, id: (row as { id: string }).id });
}
