"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { CustomFieldGroup } from "@/types/custom-fields";

const Schema = z.object({
  id: z.string().uuid(),
  name_translations: z
    .record(z.string(), z.string().max(200))
    .refine((t) => t.el === undefined || t.el.trim().length > 0, {
      message: "Η ελληνική ονομασία δεν μπορεί να είναι κενή",
    })
    .optional(),
  description: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});

export async function updateCustomFieldGroup(
  input: z.input<typeof Schema>
): Promise<Result<CustomFieldGroup>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<CustomFieldGroup>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<CustomFieldGroup>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();
  const patch: Record<string, unknown> = {};
  if (parsed.data.name_translations !== undefined)
    patch.name_translations = parsed.data.name_translations;
  if (parsed.data.description !== undefined)
    patch.description = parsed.data.description;
  if (parsed.data.active !== undefined) patch.active = parsed.data.active;

  if (Object.keys(patch).length === 0) {
    return fail<CustomFieldGroup>("No fields to update", "NO_CHANGES");
  }

  const { data: row, error } = await admin
    .from("custom_field_groups")
    .update(patch)
    .eq("id", parsed.data.id)
    .select()
    .single();

  if (error || !row) {
    return fail<CustomFieldGroup>(
      "Failed to update group: " + error?.message,
      error?.code
    );
  }

  revalidatePath("/admin/custom-fields");
  return ok(row as CustomFieldGroup);
}
