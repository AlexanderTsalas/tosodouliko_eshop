"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { Role } from "@/types/rbac";

const Schema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/).optional(),
  description: z.string().max(500).nullable().optional(),
});

export async function updateRole(
  input: z.input<typeof Schema>
): Promise<Result<Role>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<Role>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:roles"))) {
    return fail<Role>("Forbidden", "FORBIDDEN");
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.description !== undefined) update.description = parsed.data.description;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("roles")
    .update(update)
    .eq("id", parsed.data.id)
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") return fail<Role>("Role name already exists", "DUPLICATE");
    return fail<Role>(error?.message ?? "Update failed", error?.code);
  }
  revalidatePath("/admin/roles");
  revalidatePath(`/admin/roles/${parsed.data.id}/edit`);
  return ok(data as unknown as Role);
}
