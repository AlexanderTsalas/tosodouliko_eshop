"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ userId: z.string().uuid() });

/**
 * Admin-side user deletion via the Supabase auth.admin API. Cascades through
 * FK ON DELETE CASCADE to user_profiles, user_roles, addresses, carts,
 * wishlists, sessions, return_requests. Refuses to delete:
 *  - yourself (use a different admin account)
 *  - the last admin (would lock everyone out)
 *  - users with existing orders (orders.user_id has no cascade — order
 *    history is preserved). The admin should reassign or anonymize first.
 */
export async function deleteUser(
  input: z.input<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:users"))) {
    return fail<null>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<null>("Not authenticated", "UNAUTHENTICATED");

  if (authData.user.id === parsed.data.userId) {
    return fail<null>("You cannot delete your own account.", "SELF_DELETE");
  }

  const admin = createAdminClient();

  // Last-admin guard.
  const { data: targetRoles } = await admin
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", parsed.data.userId);

  const targetIsAdmin = ((targetRoles ?? []) as unknown as {
    roles: { name: string } | { name: string }[] | null;
  }[]).some((row) => {
    const r = row.roles;
    if (Array.isArray(r)) return r.some((x) => x?.name === "admin");
    return r?.name === "admin";
  });

  if (targetIsAdmin) {
    const { data: adminRoleRow } = await admin
      .from("roles")
      .select("id")
      .eq("name", "admin")
      .maybeSingle();

    if (adminRoleRow) {
      const { count } = await admin
        .from("user_roles")
        .select("user_id", { count: "exact", head: true })
        .eq("role_id", (adminRoleRow as { id: string }).id)
        .neq("user_id", parsed.data.userId);

      if (!count || count === 0) {
        return fail<null>(
          "Cannot delete the last admin. Promote another user first.",
          "LAST_ADMIN"
        );
      }
    }
  }

  // Order-history guard. Orders attach to customers (not auth.users directly),
  // so we look up via the user's customer record. A user with no customer row
  // can't have orders.
  const { data: customerRow } = await admin
    .from("customers")
    .select("id")
    .eq("auth_user_id", parsed.data.userId)
    .maybeSingle();
  const targetCustomerId = (customerRow as { id: string } | null)?.id ?? null;

  let orderCount = 0;
  if (targetCustomerId) {
    const { count } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", targetCustomerId);
    orderCount = count ?? 0;
  }

  if (orderCount > 0) {
    return fail<null>(
      `User has ${orderCount} order(s). Order history blocks deletion. Anonymize the account instead, or unlink the customer record from this auth user first.`,
      "HAS_ORDERS"
    );
  }

  const { error } = await admin.auth.admin.deleteUser(parsed.data.userId);
  if (error) return fail<null>(error.message, "DELETE_FAILED");

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "user.deleted",
    resource_type: "user",
    resource_id: parsed.data.userId,
  });

  revalidatePath("/admin/users");
  return ok(null);
}
