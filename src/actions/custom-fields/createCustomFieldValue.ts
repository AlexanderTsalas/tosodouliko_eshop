"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { CustomFieldValue } from "@/types/custom-fields";

const Schema = z.object({
  field_id: z.string().uuid(),
  /** For dropdown/multi_select: a string option key. For boolean, this
   *  action is rejected (use updateCustomFieldValue on the seeded rows
   *  instead). */
  value: z.union([z.string().min(1).max(100), z.number(), z.boolean()]),
  label_translations: z
    .record(z.string(), z.string().max(200))
    .refine((t) => typeof t.el === "string" && t.el.trim().length > 0, {
      message: "Η ελληνική ετικέτα της τιμής είναι υποχρεωτική",
    }),
  modifier_kind: z.enum(["none", "flat", "percent"]).default("none"),
  modifier_amount: z.number().default(0),
  message_translations: z
    .record(z.string(), z.string().max(500))
    .nullable()
    .optional(),
  sort_order: z.number().int().nonnegative().default(0),
});

/**
 * Adds a new value (option) to a dropdown/multi_select field. Boolean
 * fields are rejected — their true/false rows are seeded at field
 * creation and can only be updated, not re-created.
 *
 * Text and number fields have no values at all; the parent field's
 * data_type check enforces this.
 */
export async function createCustomFieldValue(
  input: z.input<typeof Schema>
): Promise<Result<CustomFieldValue>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<CustomFieldValue>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<CustomFieldValue>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();

  // Reject if the parent field isn't a deterministic type that accepts
  // user-added values (dropdown / multi_select).
  const { data: parent } = await admin
    .from("custom_fields")
    .select("data_type")
    .eq("id", parsed.data.field_id)
    .maybeSingle();
  if (!parent) {
    return fail<CustomFieldValue>("Field not found", "NOT_FOUND");
  }
  const allowed = ["dropdown", "multi_select"];
  if (!allowed.includes((parent as { data_type: string }).data_type)) {
    return fail<CustomFieldValue>(
      "Δεν προστίθενται τιμές σε αυτόν τον τύπο πεδίου.",
      "INVALID_FIELD_TYPE"
    );
  }

  const { data: row, error } = await admin
    .from("custom_field_values")
    .insert({
      field_id: parsed.data.field_id,
      value: parsed.data.value,
      label_translations: parsed.data.label_translations,
      modifier_kind: parsed.data.modifier_kind,
      modifier_amount: parsed.data.modifier_amount,
      message_translations: parsed.data.message_translations ?? null,
      sort_order: parsed.data.sort_order,
    })
    .select()
    .single();

  if (error || !row) {
    if (error?.code === "23505") {
      return fail<CustomFieldValue>(
        "Η τιμή υπάρχει ήδη σε αυτό το πεδίο.",
        "DUPLICATE_VALUE"
      );
    }
    return fail<CustomFieldValue>(
      "Failed to create value: " + error?.message,
      error?.code
    );
  }

  revalidatePath("/admin/custom-fields");
  return ok(row as CustomFieldValue);
}
