"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
});

export async function revokeRole(
  input: z.input<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<null>("Not authenticated", "UNAUTHENTICATED");

  if (!(await checkPermission("manage:roles"))) {
    return fail<null>("Forbidden", "FORBIDDEN");
  }

  // Safety: don't let an admin remove their own admin role if it'd lock them out.
  if (parsed.data.userId === authData.user.id) {
    const admin = createAdminClient();
    const { data: targetRole } = await admin
      .from("roles")
      .select("name")
      .eq("id", parsed.data.roleId)
      .maybeSingle();
    if ((targetRole as any)?.name === "admin") {
      // Check that another admin exists.
      const { count } = await admin
        .from("user_roles")
        .select("user_id", { count: "exact", head: true })
        .eq("role_id", parsed.data.roleId)
        .neq("user_id", authData.user.id);
      if (!count || count === 0) {
        return fail<null>(
          "Cannot remove your own admin role — no other admin exists.",
          "LAST_ADMIN"
        );
      }
    }
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("user_roles")
    .delete()
    .eq("user_id", parsed.data.userId)
    .eq("role_id", parsed.data.roleId);

  if (error) return fail<null>(error.message, error.code);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "rbac.role.revoked",
    resource_type: "user",
    resource_id: parsed.data.userId,
    metadata: { roleId: parsed.data.roleId },
  });

  revalidatePath(`/admin/users/${parsed.data.userId}`);
  return ok(null);
}
