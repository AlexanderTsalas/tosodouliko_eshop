"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ id: z.string().uuid() });

/**
 * Deletes a value (dropdown/multi_select option). Boolean rows can't be
 * deleted by design — they're seeded at field creation as true/false
 * and any deletion attempt is rejected here.
 *
 * Cascades to custom_field_value_subfields (sub-field triggers from
 * this value) via FK. Historical order_item_custom_fields rows are
 * fine because they store the raw value, not a FK to this row.
 */
export async function deleteCustomFieldValue(
  input: z.input<typeof Schema>
): Promise<Result<{ id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ id: string }>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<{ id: string }>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();

  // Reject deletion of boolean rows — the type expects exactly two
  // canonical values.
  const { data: row } = await admin
    .from("custom_field_values")
    .select("field_id, custom_fields(data_type)")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (!row) return fail<{ id: string }>("Value not found", "NOT_FOUND");
  type Joined = {
    field_id: string;
    custom_fields: { data_type: string } | { data_type: string }[] | null;
  };
  const joined = row as Joined;
  const parent = Array.isArray(joined.custom_fields)
    ? joined.custom_fields[0]
    : joined.custom_fields;
  if (parent?.data_type === "boolean") {
    return fail<{ id: string }>(
      "Δεν διαγράφονται οι τιμές true/false. Επεξεργαστείτε τες αντί για διαγραφή.",
      "BOOLEAN_VALUE_PROTECTED"
    );
  }

  const { error } = await admin
    .from("custom_field_values")
    .delete()
    .eq("id", parsed.data.id);

  if (error) {
    return fail<{ id: string }>(
      "Failed to delete value: " + error.message,
      error.code
    );
  }

  revalidatePath("/admin/custom-fields");
  return ok({ id: parsed.data.id });
}
