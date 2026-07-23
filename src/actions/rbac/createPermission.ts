"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { Permission } from "@/types/rbac";

const Schema = z.object({
  resource: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  action: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/),
  description: z.string().max(500).optional(),
});

export async function createPermission(
  input: z.input<typeof Schema>
): Promise<Result<Permission>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<Permission>("Invalid input: " + parsed.error.issues[0].message, "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:roles"))) {
    return fail<Permission>("Forbidden", "FORBIDDEN");
  }

  const name = `${parsed.data.action}:${parsed.data.resource}`;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("permissions")
    .insert({
      name,
      resource: parsed.data.resource,
      action: parsed.data.action,
      description: parsed.data.description ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") return fail<Permission>("Permission already exists", "DUPLICATE");
    return fail<Permission>(error?.message ?? "Insert failed", error?.code);
  }
  revalidatePath("/admin/permissions");
  return ok(data as unknown as Permission);
}
