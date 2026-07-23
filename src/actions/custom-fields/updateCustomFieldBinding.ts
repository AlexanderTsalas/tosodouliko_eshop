"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { CustomFieldBinding } from "@/types/custom-fields";

const Schema = z.object({
  id: z.string().uuid(),
  active: z.boolean().optional(),
  /** null inherits the field's default; boolean overrides per-binding. */
  override_required: z.boolean().nullable().optional(),
});

export async function updateCustomFieldBinding(
  input: z.input<typeof Schema>
): Promise<Result<CustomFieldBinding>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<CustomFieldBinding>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<CustomFieldBinding>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();
  const patch: Record<string, unknown> = {};
  if (parsed.data.active !== undefined) patch.active = parsed.data.active;
  if (parsed.data.override_required !== undefined)
    patch.override_required = parsed.data.override_required;

  if (Object.keys(patch).length === 0) {
    return fail<CustomFieldBinding>("No fields to update", "NO_CHANGES");
  }

  const { data: row, error } = await admin
    .from("custom_field_bindings")
    .update(patch)
    .eq("id", parsed.data.id)
    .select()
    .single();

  if (error || !row) {
    return fail<CustomFieldBinding>(
      "Failed to update binding: " + error?.message,
      error?.code
    );
  }

  revalidatePath("/admin/custom-fields");
  return ok(row as CustomFieldBinding);
}
