"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import { isBuiltInCarrier } from "@/config/carrier-slugs";
import { BUILT_IN_CARRIER_MAX_DELIVERY_METHODS } from "@/config/built-in-carrier-capabilities";

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
  slug: z.string().max(50),
  /** Editable on custom; read-only on built-in (action rejects the change). */
  display_name: z.string().trim().min(1).max(120).optional(),
  /** Editable on both; admin can narrow built-in's supported set down to whatever subset they offer. */
  supported_delivery_methods: z
    .array(DeliveryMethodValueSchema)
    .min(1)
    .max(4)
    .optional(),
  /** Editable on both. Null clears the field. */
  tracking_url_template: z.string().trim().max(2048).nullable().optional(),
  /** Editable on custom only (built-in carriers use hardcoded timelines). */
  timeline_preset: TimelinePresetSchema.optional(),
});

/**
 * Phase 9 — updates a delivery_carriers row. Same action handles both
 * custom (full edit access) and built-in (limited fields editable) carriers,
 * with per-field gating based on `is_custom`:
 *
 *   Built-in editable fields:
 *     - supported_delivery_methods   (admin can narrow)
 *     - tracking_url_template        (admin can override the seed URL)
 *
 *   Built-in read-only fields (rejected if changed):
 *     - display_name                 (tied to brand identity in code)
 *     - timeline_preset              (built-ins have hardcoded timelines)
 *
 *   Custom editable: all of the above.
 *
 * is_active toggling lives in a separate action (toggleCarrierActive) so
 * the common "just flip visibility" path doesn't go through the full
 * validation cycle.
 *
 * Permission: manage:couriers.
 */
export async function updateCarrier(
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
  const { data: existing, error: readErr } = await admin
    .from("delivery_carriers")
    .select("id, slug, is_custom, display_name, supported_delivery_methods, tracking_url_template, timeline_preset")
    .eq("slug", parsed.data.slug)
    .maybeSingle();
  if (readErr || !existing) {
    return fail("Η μεταφορική δεν βρέθηκε.", "NOT_FOUND");
  }
  type Row = {
    id: string;
    slug: string;
    is_custom: boolean;
    display_name: string;
    supported_delivery_methods: string[];
    tracking_url_template: string | null;
    timeline_preset: string | null;
  };
  const row = existing as Row;

  // Build the update payload, enforcing built-in read-only rules.
  const update: Record<string, unknown> = {};

  if (parsed.data.display_name !== undefined) {
    if (!row.is_custom && parsed.data.display_name !== row.display_name) {
      return fail<{ slug: string }>(
        "Το όνομα μεταφορικής δεν επεξεργάζεται για built-in μεταφορικές.",
        "BUILTIN_READONLY"
      );
    }
    update.display_name = parsed.data.display_name;
  }

  if (parsed.data.supported_delivery_methods !== undefined) {
    // Defence in depth — built-ins cannot expand beyond their physical
    // capability ceiling. The form filters checkboxes to the ceiling, the
    // DB trigger enforces the same; this is the middle layer that catches
    // crafted requests bypassing the UI (e.g. direct API calls).
    if (!row.is_custom && isBuiltInCarrier(row.slug)) {
      const ceiling = new Set(
        BUILT_IN_CARRIER_MAX_DELIVERY_METHODS[row.slug]
      );
      const outOfCeiling = parsed.data.supported_delivery_methods.filter(
        (m) => !ceiling.has(m)
      );
      if (outOfCeiling.length > 0) {
        return fail<{ slug: string }>(
          `Η μεταφορική ${row.display_name} δεν υποστηρίζει: ${outOfCeiling.join(", ")}.`,
          "BUILTIN_METHOD_NOT_SUPPORTED"
        );
      }
    }
    update.supported_delivery_methods = parsed.data.supported_delivery_methods;
  }

  if (parsed.data.tracking_url_template !== undefined) {
    update.tracking_url_template = parsed.data.tracking_url_template?.trim() || null;
  }

  if (parsed.data.timeline_preset !== undefined) {
    if (!row.is_custom && parsed.data.timeline_preset !== row.timeline_preset) {
      return fail<{ slug: string }>(
        "Το status timeline δεν επεξεργάζεται για built-in μεταφορικές.",
        "BUILTIN_READONLY"
      );
    }
    update.timeline_preset = parsed.data.timeline_preset;
  }

  if (Object.keys(update).length === 0) {
    // Nothing to update; treat as success.
    return ok({ slug: row.slug });
  }
  update.updated_at = new Date().toISOString();

  const { error: updErr } = await admin
    .from("delivery_carriers")
    .update(update)
    .eq("id", row.id);
  if (updErr) {
    return fail<{ slug: string }>(updErr.message, "DB_ERROR");
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "courier.updated",
    resource_type: "delivery_carrier",
    resource_id: row.id,
    metadata: {
      slug: row.slug,
      is_custom: row.is_custom,
      changes: update,
    },
  });

  revalidatePath("/admin/settings/couriers");
  updateTag(CACHE_TAGS.COURIERS);

  return ok({ slug: row.slug });
}
