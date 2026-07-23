"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ id: z.string().uuid() });

const PROTECTED_NAMES = new Set(["admin", "customer"]); // 'staff' is editable

export async function deleteRole(
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
  const { data: existing } = await admin
    .from("roles")
    .select("name")
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (existing && PROTECTED_NAMES.has((existing as any).name)) {
    return fail<null>(
      `Role '${(existing as any).name}' is protected (referenced by triggers). Edit permissions instead.`,
      "PROTECTED_ROLE"
    );
  }

  const { error } = await admin.from("roles").delete().eq("id", parsed.data.id);
  if (error) return fail<null>(error.message, error.code);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "rbac.role.deleted",
    resource_type: "role",
    resource_id: parsed.data.id,
    metadata: { name: (existing as any)?.name },
  });

  revalidatePath("/admin/roles");
  return ok(null);
}
