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

const DeliveryMethodValueSchema = z.enum([
  "home_delivery",
  "store_pickup",
  "delivery_station_pickup",
  "carrier_pickup",
]);

const TimelinePresetSchema = z.enum([
  "generic",
  "acs_style",
  "geniki_style",
  "boxnow_style",
]);

const Schema = z.object({
  display_name: z.string().trim().min(1).max(120),
  /** Subset of delivery methods this carrier supports. store_pickup is rare for custom — it's vendor-side. */
  supported_delivery_methods: z.array(DeliveryMethodValueSchema).min(1).max(4),
  tracking_url_template: z
    .string()
    .trim()
    .max(2048)
    .optional()
    .nullable(),
  /** Defaults to 'generic' when omitted — covers the common "home_delivery only" custom case. */
  timeline_preset: TimelinePresetSchema.default("generic"),
});

interface CreateResult {
  slug: string;
  id: string;
}

/**
 * Phase 9 — creates a custom (admin-defined) carrier row in
 * delivery_carriers. Slug is auto-generated and opaque
 * (`custom_<random12hex>`); the display_name is what humans see at
 * checkout. is_custom=true and is_active=false by default — admin opts in
 * to visibility via the per-row toggle once they've finished setup.
 *
 * Built-in carriers (acs, elta, etc.) can't be created here — they're
 * seeded via migration. Re-using their slug fails on the unique constraint.
 *
 * Permission: manage:couriers.
 */
export async function createCustomCarrier(
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

  // Generate an opaque, collision-resistant slug. 12 hex chars = 48 bits of
  // randomness; chance of collision against a few hundred custom carriers is
  // negligible. The 'custom_' prefix makes the bucket visually obvious in DB
  // queries and audit logs.
  const slug = `custom_${randomBytes(6).toString("hex")}`;

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("delivery_carriers")
    .insert({
      slug,
      display_name: parsed.data.display_name,
      supported_delivery_methods: parsed.data.supported_delivery_methods,
      is_active: false,
      is_custom: true,
      display_order: 1000, // custom carriers go after the seeded built-ins
      tracking_url_template: parsed.data.tracking_url_template?.trim() || null,
      timeline_preset: parsed.data.timeline_preset,
      created_by: authData.user.id,
    })
    .select("id, slug")
    .single();

  if (error || !row) {
    return fail<CreateResult>(
      error?.message ?? "Σφάλμα δημιουργίας μεταφορικής.",
      "DB_ERROR"
    );
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "courier.custom_created",
    resource_type: "delivery_carrier",
    resource_id: (row as { id: string }).id,
    metadata: {
      slug,
      display_name: parsed.data.display_name,
      supported_delivery_methods: parsed.data.supported_delivery_methods,
      timeline_preset: parsed.data.timeline_preset,
    },
  });

  revalidatePath("/admin/settings/couriers");
  updateTag(CACHE_TAGS.COURIERS);

  return ok({ slug, id: (row as { id: string }).id });
}
