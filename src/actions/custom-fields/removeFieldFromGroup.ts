"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  group_id: z.string().uuid(),
  field_id: z.string().uuid(),
});

export async function removeFieldFromGroup(
  input: z.input<typeof Schema>
): Promise<Result<{ group_id: string; field_id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:products"))) {
    return fail("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("custom_field_group_members")
    .delete()
    .eq("group_id", parsed.data.group_id)
    .eq("field_id", parsed.data.field_id);

  if (error) {
    return fail("Failed to remove member: " + error.message, error.code);
  }

  revalidatePath("/admin/custom-fields");
  return ok({ group_id: parsed.data.group_id, field_id: parsed.data.field_id });
}
