"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, concurrentEdit, type Result } from "@/types/result";

const Schema = z.object({
  order_id: z.string().uuid(),
  /** Carrier voucher / parcel ID. Empty string clears the field. */
  tracking_number: z.string().max(120).optional().default(""),
  /** One-off URL override. Empty string clears. */
  tracking_url_override: z.string().max(2048).optional().default(""),
  /** Optimistic-lock guard from the page that rendered this form. */
  expected_updated_at: z.string().optional(),
});

/**
 * Manually edit tracking fields on an order. Used by the admin order detail
 * page for:
 *
 *   - Non-integrated carriers (custom or built-in without API): admin
 *     creates the voucher in the carrier's portal and types the number here
 *   - One-off override URLs when the carrier's standard tracking_url_template
 *     doesn't apply
 *
 * For API-integrated carriers, createVoucher writes tracking_number
 * automatically — admins rarely need to touch this field unless correcting
 * a misfire.
 *
 * Empty strings clear the corresponding field (NULL in DB), so the admin
 * can erase a wrong entry by saving an empty form.
 */
export async function saveOrderTracking(
  input: z.input<typeof Schema>
): Promise<Result<{ orderId: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail("Invalid input", "INVALID_INPUT");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail("Συνδεθείτε για να συνεχίσετε.", "UNAUTHENTICATED");
  }

  if (!(await checkPermission("manage:orders"))) {
    return fail("Δεν έχετε δικαίωμα διαχείρισης παραγγελιών.", "FORBIDDEN");
  }

  const admin = createAdminClient();

  // Read current values for the audit log + carrier (needed for the
  // shipments-row auto-create below).
  const { data: existing } = await admin
    .from("orders")
    .select(
      "id, order_number, tracking_number, tracking_url_override, carrier"
    )
    .eq("id", parsed.data.order_id)
    .maybeSingle();
  if (!existing) {
    return fail("Η παραγγελία δεν βρέθηκε.", "NOT_FOUND");
  }
  const existingRow = existing as {
    id: string;
    order_number: string;
    tracking_number: string | null;
    tracking_url_override: string | null;
    carrier: string | null;
  };

  const next = {
    tracking_number:
      parsed.data.tracking_number.trim() === ""
        ? null
        : parsed.data.tracking_number.trim(),
    tracking_url_override:
      parsed.data.tracking_url_override.trim() === ""
        ? null
        : parsed.data.tracking_url_override.trim(),
    updated_at: new Date().toISOString(),
  };

  // Optimistic-lock UPDATE — when expected_updated_at is passed, the
  // write fails (returns zero rows) if anyone else has advanced the
  // order since the form loaded. Programmatic callers (webhook,
  // createVoucher) can omit it and keep the legacy unconditional
  // semantics.
  let updateQuery = admin
    .from("orders")
    .update(next)
    .eq("id", parsed.data.order_id);
  if (parsed.data.expected_updated_at) {
    updateQuery = updateQuery.eq("updated_at", parsed.data.expected_updated_at);
  }
  const { data: updatedRows, error: updErr } = await updateQuery.select("id");
  if (updErr) {
    return fail<{ orderId: string }>(updErr.message, "DB_ERROR");
  }
  if (
    parsed.data.expected_updated_at &&
    (!updatedRows || updatedRows.length === 0)
  ) {
    return concurrentEdit<{ orderId: string }>();
  }

  // Auto-create a shipments row when a tracking number is being
  // ADDED (null → non-null transition) AND no shipment row already
  // exists for this (order, tracking_number) pair. Matches the
  // behavior of createVoucher for API-integrated carriers — both
  // paths now leave a shipments audit trail when there's an actual
  // tracking number to log.
  //
  // Skipped when:
  //   - the admin is CLEARING the tracking number (next is null)
  //   - the admin is correcting an existing tracking number (the
  //     previous row's tracking_number was already set — we don't
  //     touch existing shipment rows; they're the dispatch history)
  //   - the order has no carrier (nothing to attribute the dispatch to)
  //   - a shipments row already exists with this tracking number
  //     (idempotent retry guard)
  if (
    next.tracking_number !== null &&
    existingRow.tracking_number === null &&
    existingRow.carrier
  ) {
    const { data: existingShipment } = await admin
      .from("shipments")
      .select("id")
      .eq("order_id", parsed.data.order_id)
      .eq("tracking_number", next.tracking_number)
      .maybeSingle();
    if (!existingShipment) {
      // Build a tracking_url from the carrier template if possible —
      // matches the customer-facing URL the order detail page would
      // render via buildTrackingUrl.
      let resolvedTrackingUrl: string | null = next.tracking_url_override;
      if (!resolvedTrackingUrl) {
        const { data: carrierRow } = await admin
          .from("delivery_carriers")
          .select("tracking_url_template")
          .eq("slug", existingRow.carrier)
          .maybeSingle();
        const tmpl = (carrierRow as { tracking_url_template: string | null } | null)
          ?.tracking_url_template;
        if (tmpl) {
          resolvedTrackingUrl = tmpl.replace(
            "{tracking_number}",
            encodeURIComponent(next.tracking_number)
          );
        }
      }
      await admin.from("shipments").insert({
        order_id: parsed.data.order_id,
        courier: existingRow.carrier,
        tracking_number: next.tracking_number,
        tracking_url: resolvedTrackingUrl,
        status: "label_created",
      });
    }
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "order.tracking_updated",
    resource_type: "order",
    resource_id: parsed.data.order_id,
    metadata: {
      order_number: existingRow.order_number,
      tracking_number_before: existingRow.tracking_number,
      tracking_number_after: next.tracking_number,
      tracking_url_override_before: existingRow.tracking_url_override,
      tracking_url_override_after: next.tracking_url_override,
    },
  });

  revalidatePath(`/admin/orders/${parsed.data.order_id}`);
  revalidatePath(`/orders/${parsed.data.order_id}`);

  return ok({ orderId: parsed.data.order_id });
}
