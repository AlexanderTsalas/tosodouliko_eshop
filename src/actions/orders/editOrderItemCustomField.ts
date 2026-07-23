"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { CustomField } from "@/types/custom-fields";

const Schema = z.object({
  id: z.string().uuid(),
  /** New value — shape depends on the parent field's data_type. The
   *  action validates the shape server-side. */
  value: z.unknown(),
  /** Required reason captured for the audit trail. Operations teams
   *  need to know why a value was edited (typo fix, customer call,
   *  workshop change). */
  reason: z.string().min(1).max(500),
});

// Fulfillment statuses after which admin-only fields freeze. Anything
// from 'shipped' onwards is too late — the workshop has committed, the
// parcel is in motion, etc.
const FROZEN_AFTER_STATUSES = new Set([
  "shipped",
  "ready_for_pickup",
  "delivered",
  "picked_up",
  "cancelled",
]);

/**
 * Admin edit of a single order_item_custom_field value. Subject to the
 * field's `edit_policy`:
 *
 *   - 'frozen' → never editable, regardless of order status
 *   - 'admin_until_dispatch' → editable WHILE order.fulfillment_status
 *      is pre-shipped (draft/pending/confirmed/preparing)
 *
 * IMPORTANT: this action does NOT touch the line's `contributed_price`
 * or the order's totals. Customer-facing price is locked from the
 * moment of payment — admin edits only update the value the workshop
 * sees. Otherwise an admin "fix" of a dropdown could secretly mutate
 * the customer's bill.
 */
export async function editOrderItemCustomField(
  input: z.input<typeof Schema>
): Promise<Result<{ id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ id: string }>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:orders"))) {
    return fail<{ id: string }>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<{ id: string }>("Not authenticated", "UNAUTHENTICATED");
  }
  const actorId = authData.user.id;

  const admin = createAdminClient();

  // Load the row + parent field + order status in one shot.
  const { data: row } = await admin
    .from("order_item_custom_fields")
    .select(
      "id, value, contributed_price, field_id, order_item_id, " +
        "custom_fields(*), order_items(order_id, orders(fulfillment_status))"
    )
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (!row) {
    return fail<{ id: string }>("Row not found", "NOT_FOUND");
  }

  type Joined = {
    id: string;
    value: unknown;
    contributed_price: number | string;
    field_id: string;
    order_item_id: string;
    custom_fields: CustomField | CustomField[] | null;
    order_items:
      | { order_id: string; orders: { fulfillment_status: string } | { fulfillment_status: string }[] | null }
      | Array<{
          order_id: string;
          orders:
            | { fulfillment_status: string }
            | { fulfillment_status: string }[]
            | null;
        }>
      | null;
  };
  const joined = row as unknown as Joined;
  const field = Array.isArray(joined.custom_fields)
    ? joined.custom_fields[0]
    : joined.custom_fields;
  if (!field) {
    return fail<{ id: string }>("Field metadata missing", "FIELD_NOT_FOUND");
  }

  const oi = Array.isArray(joined.order_items)
    ? joined.order_items[0]
    : joined.order_items;
  const ordersJoin = oi?.orders;
  const orderRow = Array.isArray(ordersJoin) ? ordersJoin[0] : ordersJoin;
  const fulfillmentStatus = orderRow?.fulfillment_status ?? null;

  // Enforce edit_policy + status gate.
  if (field.edit_policy === "frozen") {
    return fail<{ id: string }>(
      "Αυτό το πεδίο είναι παγωμένο μετά την πληρωμή.",
      "FIELD_FROZEN"
    );
  }
  if (
    fulfillmentStatus &&
    FROZEN_AFTER_STATUSES.has(fulfillmentStatus)
  ) {
    return fail<{ id: string }>(
      "Η παραγγελία έχει προχωρήσει — η επεξεργασία πεδίων δεν επιτρέπεται.",
      "ORDER_DISPATCHED"
    );
  }

  // Validate the new value against the field's data_type + validation.
  const validation = field.validation as Record<string, unknown>;
  const newValue = parsed.data.value;
  const valError = validateNewValue(
    field.data_type,
    newValue,
    validation
  );
  if (valError) {
    return fail<{ id: string }>(valError, "INVALID_VALUE");
  }

  // Capture the old value for the audit trail.
  const oldValue = joined.value;

  // Update — keep contributed_price as-is (customer's bill is locked).
  const { error: updateErr } = await admin
    .from("order_item_custom_fields")
    .update({ value: newValue as object | string | number | boolean | null })
    .eq("id", parsed.data.id);
  if (updateErr) {
    return fail<{ id: string }>(
      "Update failed: " + updateErr.message,
      updateErr.code
    );
  }

  await logAuditEvent({
    actor_id: actorId,
    actor_type: "user",
    action: "order_item_custom_field.edited",
    resource_type: "order_item_custom_field",
    resource_id: parsed.data.id,
    metadata: {
      field_key: field.key,
      order_item_id: joined.order_item_id,
      old_value: oldValue,
      new_value: newValue,
      reason: parsed.data.reason,
    },
  });

  revalidatePath(`/admin/orders/${oi?.order_id ?? ""}`);
  return ok({ id: parsed.data.id });
}

// ─── Local lightweight validator ───────────────────────────────────
// Kept here (instead of reusing validateSubmittedCustomFields) because
// admin edits aren't subject to "applicable to product" checks — the
// field is already on the order, so we only sanity-check the new
// value's shape.

function validateNewValue(
  data_type: string,
  raw: unknown,
  validation: Record<string, unknown>
): string | null {
  switch (data_type) {
    case "text": {
      if (typeof raw !== "string") return "Αναμένεται κείμενο.";
      const max = validation.maxLength;
      if (typeof max === "number" && raw.length > max) {
        return `Πάνω από το όριο των ${max} χαρακτήρων.`;
      }
      if (typeof validation.regex === "string" && validation.regex.length > 0) {
        try {
          if (!new RegExp(validation.regex).test(raw)) {
            return "Η μορφή δεν είναι σωστή.";
          }
        } catch {
          /* malformed regex — ignore */
        }
      }
      return null;
    }
    case "number": {
      let num: number;
      if (typeof raw === "number") num = raw;
      else if (typeof raw === "string") num = parseFloat(raw);
      else return "Αναμένεται αριθμός.";
      if (Number.isNaN(num)) return "Αναμένεται αριθμός.";
      if (validation.integerOnly === true && !Number.isInteger(num))
        return "Δεκτοί μόνο ακέραιοι αριθμοί.";
      if (
        typeof validation.min === "number" &&
        num < (validation.min as number)
      )
        return `Τουλάχιστον ${validation.min}.`;
      if (
        typeof validation.max === "number" &&
        num > (validation.max as number)
      )
        return `Έως ${validation.max}.`;
      return null;
    }
    case "boolean":
      if (typeof raw !== "boolean") return "Αναμένεται true/false.";
      return null;
    case "dropdown":
      if (typeof raw !== "string" || raw.length === 0)
        return "Αναμένεται μη κενή τιμή.";
      return null;
    case "multi_select":
      if (!Array.isArray(raw)) return "Αναμένεται λίστα τιμών.";
      if (!raw.every((x) => typeof x === "string"))
        return "Όλες οι τιμές πρέπει να είναι strings.";
      return null;
    default:
      return null;
  }
}
