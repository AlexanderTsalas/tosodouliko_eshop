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
  accountType: z.enum(["customer", "internal"]),
});

/**
 * Flip a user's coarse identity boundary (customer ↔ internal). This is the
 * only explicit demotion path; promotion also happens implicitly via
 * createUser / assignRole. Writes through the service role, which bypasses the
 * account_type guard trigger.
 *
 * Guards:
 *  - manage:users required.
 *  - Cannot change your own account_type (a self-demotion would lock you out
 *    mid-request).
 *  - Cannot demote the last admin to customer: an admin keeps the admin role
 *    but account_type='customer' makes has_permission fail for them, so this
 *    could lock the whole back office out.
 */
export async function setAccountType(
  input: z.infer<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<null>("Not authenticated", "UNAUTHENTICATED");

  if (!(await checkPermission("manage:users"))) {
    return fail<null>("Forbidden", "FORBIDDEN");
  }

  if (authData.user.id === parsed.data.userId) {
    return fail<null>("You cannot change your own account type.", "SELF_CHANGE");
  }

  const admin = createAdminClient();

  // Last-admin demotion guard.
  if (parsed.data.accountType === "customer") {
    const { data: adminRole } = await admin
      .from("roles")
      .select("id")
      .eq("name", "admin")
      .maybeSingle();

    if (adminRole) {
      const { data: targetHasAdmin } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("user_id", parsed.data.userId)
        .eq("role_id", adminRole.id)
        .maybeSingle();

      if (targetHasAdmin) {
        const { data: otherAdminRows } = await admin
          .from("user_roles")
          .select("user_id")
          .eq("role_id", adminRole.id)
          .neq("user_id", parsed.data.userId);

        const otherAdminIds = (otherAdminRows ?? []).map((r) => r.user_id);
        let hasOtherInternalAdmin = false;
        if (otherAdminIds.length > 0) {
          const { count } = await admin
            .from("user_profiles")
            .select("id", { count: "exact", head: true })
            .in("id", otherAdminIds)
            .eq("account_type", "internal");
          hasOtherInternalAdmin = (count ?? 0) > 0;
        }

        if (!hasOtherInternalAdmin) {
          return fail<null>(
            "Cannot demote the last admin to customer. Promote another admin first.",
            "LAST_ADMIN"
          );
        }
      }
    }
  }

  const { error } = await admin
    .from("user_profiles")
    .update({ account_type: parsed.data.accountType })
    .eq("id", parsed.data.userId);

  if (error) return fail<null>(error.message, error.code);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "user.account_type.changed",
    resource_type: "user",
    resource_id: parsed.data.userId,
    metadata: { account_type: parsed.data.accountType },
  });

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  return ok(null);
}
