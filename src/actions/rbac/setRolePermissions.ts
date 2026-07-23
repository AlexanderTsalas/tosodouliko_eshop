"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  roleId: z.string().uuid(),
  permissionIds: z.array(z.string().uuid()),
});

/**
 * Atomic replace of a role's permission set. Deletes existing role_permissions
 * rows and inserts the new set in a single transaction-like flow.
 */
export async function setRolePermissions(
  input: z.input<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:roles"))) {
    return fail<null>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<null>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();

  const { error: delErr } = await admin
    .from("role_permissions")
    .delete()
    .eq("role_id", parsed.data.roleId);
  if (delErr) return fail<null>(delErr.message, delErr.code);

  if (parsed.data.permissionIds.length > 0) {
    const rows = parsed.data.permissionIds.map((pid) => ({
      role_id: parsed.data.roleId,
      permission_id: pid,
    }));
    const { error: insErr } = await admin.from("role_permissions").insert(rows);
    if (insErr) return fail<null>(insErr.message, insErr.code);
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "rbac.role.permissions_set",
    resource_type: "role",
    resource_id: parsed.data.roleId,
    metadata: { count: parsed.data.permissionIds.length },
  });

  revalidatePath(`/admin/roles/${parsed.data.roleId}/edit`);
  return ok(null);
}
