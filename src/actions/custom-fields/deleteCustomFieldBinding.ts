"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ id: z.string().uuid() });

export async function deleteCustomFieldBinding(
  input: z.input<typeof Schema>
): Promise<Result<{ id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ id: string }>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<{ id: string }>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("custom_field_bindings")
    .delete()
    .eq("id", parsed.data.id);

  if (error) {
    return fail<{ id: string }>(
      "Failed to delete binding: " + error.message,
      error.code
    );
  }

  revalidatePath("/admin/custom-fields");
  return ok({ id: parsed.data.id });
}
