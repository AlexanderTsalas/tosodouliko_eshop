"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ id: z.string().uuid() });

// These names are used in RLS policies across the schema — deleting them
// would silently return false for every check.
const PROTECTED_NAMES = new Set([
  "manage:roles",
  "manage:users",
  "manage:products",
  "manage:categories",
  "manage:attributes",
  "manage:media",
  "manage:discounts",
  "manage:orders",
  "manage:returns",
  "manage:shipping",
  "manage:shipments",
  "manage:currencies",
  "manage:translations",
  "manage:seo",
  "manage:newsletter",
  "manage:chat",
  "read:audit-log",
  "read:errors",
  "read:tracking",
]);

export async function deletePermission(
  input: z.input<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:roles"))) {
    return fail<null>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("permissions")
    .select("name")
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (existing && PROTECTED_NAMES.has((existing as any).name)) {
    return fail<null>(
      `Permission '${(existing as any).name}' is referenced by RLS policies — cannot delete.`,
      "PROTECTED_PERMISSION"
    );
  }

  const { error } = await admin.from("permissions").delete().eq("id", parsed.data.id);
  if (error) return fail<null>(error.message, error.code);
  revalidatePath("/admin/permissions");
  return ok(null);
}
