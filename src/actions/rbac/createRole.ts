"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { Role } from "@/types/rbac";

const Schema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/, "lowercase + digits + - or _ only"),
  description: z.string().max(500).optional(),
});

export async function createRole(
  input: z.input<typeof Schema>
): Promise<Result<Role>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<Role>("Invalid input: " + parsed.error.issues[0].message, "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:roles"))) {
    return fail<Role>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<Role>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("roles")
    .insert({ name: parsed.data.name, description: parsed.data.description ?? null })
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") return fail<Role>("Role name already exists", "DUPLICATE");
    return fail<Role>(error?.message ?? "Insert failed", error?.code);
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "rbac.role.created",
    resource_type: "role",
    resource_id: (data as any).id,
    metadata: { name: parsed.data.name },
  });

  revalidatePath("/admin/roles");
  return ok(data as unknown as Role);
}
