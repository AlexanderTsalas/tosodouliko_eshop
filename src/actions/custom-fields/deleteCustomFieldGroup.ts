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
 * Deletes a group. FK cascade tears down:
 *   - custom_field_group_members
 *   - custom_field_bindings (any binding pointing at this group)
 *
 * The member fields themselves stay in the library (groups are just
 * bundles; deleting the bundle doesn't delete the contents).
 */
export async function deleteCustomFieldGroup(
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
    .from("custom_field_groups")
    .delete()
    .eq("id", parsed.data.id);

  if (error) {
    return fail<{ id: string }>(
      "Failed to delete group: " + error.message,
      error.code
    );
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "custom_field_group.deleted",
    resource_type: "custom_field_group",
    resource_id: parsed.data.id,
    metadata: {},
  });

  revalidatePath("/admin/custom-fields");
  return ok({ id: parsed.data.id });
}
