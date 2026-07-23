"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { CustomFieldValue } from "@/types/custom-fields";

const Schema = z.object({
  id: z.string().uuid(),
  label_translations: z
    .record(z.string(), z.string().max(200))
    .refine((t) => t.el === undefined || t.el.trim().length > 0, {
      message: "Η ελληνική ετικέτα της τιμής δεν μπορεί να είναι κενή",
    })
    .optional(),
  modifier_kind: z.enum(["none", "flat", "percent"]).optional(),
  modifier_amount: z.number().optional(),
  message_translations: z
    .record(z.string(), z.string().max(500))
    .nullable()
    .optional(),
  sort_order: z.number().int().nonnegative().optional(),
});

/**
 * Updates a value row's label/modifier/message/sort. The value itself
 * (true/false for boolean, the option key for dropdown/multi_select) is
 * immutable — changing it would break any order_item_custom_fields rows
 * that reference it. To change the value key, delete + re-create.
 */
export async function updateCustomFieldValue(
  input: z.input<typeof Schema>
): Promise<Result<CustomFieldValue>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<CustomFieldValue>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<CustomFieldValue>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();
  const patch: Record<string, unknown> = {};
  if (parsed.data.label_translations !== undefined)
    patch.label_translations = parsed.data.label_translations;
  if (parsed.data.modifier_kind !== undefined)
    patch.modifier_kind = parsed.data.modifier_kind;
  if (parsed.data.modifier_amount !== undefined)
    patch.modifier_amount = parsed.data.modifier_amount;
  if (parsed.data.message_translations !== undefined)
    patch.message_translations = parsed.data.message_translations;
  if (parsed.data.sort_order !== undefined)
    patch.sort_order = parsed.data.sort_order;

  if (Object.keys(patch).length === 0) {
    return fail<CustomFieldValue>("No fields to update", "NO_CHANGES");
  }

  const { data: row, error } = await admin
    .from("custom_field_values")
    .update(patch)
    .eq("id", parsed.data.id)
    .select()
    .single();

  if (error || !row) {
    return fail<CustomFieldValue>(
      "Failed to update value: " + error?.message,
      error?.code
    );
  }

  revalidatePath("/admin/custom-fields");
  return ok(row as CustomFieldValue);
}
