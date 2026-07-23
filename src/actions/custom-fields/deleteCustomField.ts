"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ id: z.string().uuid() });

/**
 * Deletes a custom field. FK cascade tears down:
 *   - custom_field_values (its option list)
 *   - custom_field_value_subfields (where this field is parent OR child)
 *   - custom_field_group_members (its membership in any groups)
 *   - custom_field_bindings (any scope bindings pointing at this field)
 *
 * order_item_custom_fields uses ON DELETE RESTRICT — historical orders'
 * field values are preserved by intentionally blocking deletion if the
 * field has ever been bought. The admin needs to mark unused fields
 * invisible (`visible=false`) instead of deleting them in that case.
 */
export async function deleteCustomField(
  input: z.input<typeof Schema>
): Promise<Result<{ id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ id: string }>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<{ id: string }>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<{ id: string }>("Not authenticated", "UNAUTHENTICATED");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("custom_fields")
    .delete()
    .eq("id", parsed.data.id);

  if (error) {
    if (error.code === "23503") {
      return fail<{ id: string }>(
        "Δεν διαγράφεται — το πεδίο έχει χρησιμοποιηθεί σε παραγγελίες. Απενεργοποιήστε το ορατό flag αντί για διαγραφή.",
        "FIELD_HAS_ORDERS"
      );
    }
    return fail<{ id: string }>(
      "Failed to delete field: " + error.message,
      error.code
    );
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "custom_field.deleted",
    resource_type: "custom_field",
    resource_id: parsed.data.id,
    metadata: {},
  });

  revalidatePath("/admin/custom-fields");
  return ok({ id: parsed.data.id });
}
