import { createClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/types/result";
import type { UserRoleWithName } from "@/types/rbac";

/**
 * Returns the role names assigned to the given user (or the current
 * authenticated user if userId is omitted).
 */
export async function getUserRoles(userId?: string): Promise<Result<UserRoleWithName[]>> {
  const supabase = await createClient();

  let resolvedUserId = userId;
  if (!resolvedUserId) {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return fail<UserRoleWithName[]>("Not authenticated", "UNAUTHENTICATED");
    }
    resolvedUserId = authData.user.id;
  }

  const { data, error } = await supabase
    .from("user_roles")
    .select("user_id, role_id, assigned_by, assigned_at, roles!inner(name)")
    .eq("user_id", resolvedUserId);

  if (error) return fail<UserRoleWithName[]>(error.message, error.code);

  const rows: UserRoleWithName[] = (data ?? []).map((row: any) => ({
    user_id: row.user_id,
    role_id: row.role_id,
    assigned_by: row.assigned_by,
    assigned_at: row.assigned_at,
    role_name: row.roles?.name ?? "",
  }));

  return ok(rows);
}
