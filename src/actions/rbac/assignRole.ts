"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
});

export async function assignRole(
  input: z.infer<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<null>("Not authenticated", "UNAUTHENTICATED");

  const allowed = await checkPermission("manage:roles");
  if (!allowed) return fail<null>("Forbidden", "FORBIDDEN");

  const admin = createAdminClient();
  const { error } = await admin
    .from("user_roles")
    .upsert(
      {
        user_id: parsed.data.userId,
        role_id: parsed.data.roleId,
        assigned_by: authData.user.id,
      },
      { onConflict: "user_id,role_id" }
    );

  if (error) return fail<null>(error.message, error.code);

  // Promoting a user into any non-customer role makes them an internal
  // (back-office) user. account_type is set explicitly here — inside this
  // manage:roles-gated action, via the service role — rather than derived by
  // a DB trigger on user_roles, so a stray/direct user_roles insert can never
  // cross the boundary on its own.
  const { data: role } = await admin
    .from("roles")
    .select("name")
    .eq("id", parsed.data.roleId)
    .maybeSingle();
  if (role && role.name !== "customer") {
    await admin
      .from("user_profiles")
      .update({ account_type: "internal" })
      .eq("id", parsed.data.userId);
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "rbac.role.assigned",
    resource_type: "user",
    resource_id: parsed.data.userId,
    metadata: { roleId: parsed.data.roleId },
  });

  return ok(null);
}
