"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { CustomField } from "@/types/custom-fields";

const Schema = z.object({
  id: z.string().uuid(),
  // Partial updates allowed; only validate that if `el` is set, it's
  // non-empty (we still don't allow blanking the Greek label).
  label_translations: z
    .record(z.string(), z.string().max(200))
    .refine((t) => t.el === undefined || t.el.trim().length > 0, {
      message: "Η ελληνική ετικέτα δεν μπορεί να είναι κενή",
    })
    .optional(),
  required_default: z.boolean().optional(),
  visible: z.boolean().optional(),
  per_unit: z.boolean().optional(),
  validation: z.record(z.string(), z.unknown()).optional(),
  edit_policy: z.enum(["frozen", "admin_until_dispatch"]).optional(),
});

/**
 * Updates a custom field's metadata (label, validation, flags). The
 * field's `data_type` and `key` are immutable after creation — changing
 * type would invalidate every saved value, and changing key would break
 * any code referring to it. To "rename" a key, delete + recreate.
 */
export async function updateCustomField(
  input: z.input<typeof Schema>
): Promise<Result<CustomField>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<CustomField>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<CustomField>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<CustomField>("Not authenticated", "UNAUTHENTICATED");
  }

  const admin = createAdminClient();
  const patch: Record<string, unknown> = {};
  if (parsed.data.label_translations !== undefined)
    patch.label_translations = parsed.data.label_translations;
  if (parsed.data.required_default !== undefined)
    patch.required_default = parsed.data.required_default;
  if (parsed.data.visible !== undefined) patch.visible = parsed.data.visible;
  if (parsed.data.per_unit !== undefined) patch.per_unit = parsed.data.per_unit;
  if (parsed.data.validation !== undefined)
    patch.validation = parsed.data.validation;
  if (parsed.data.edit_policy !== undefined)
    patch.edit_policy = parsed.data.edit_policy;

  if (Object.keys(patch).length === 0) {
    return fail<CustomField>("No fields to update", "NO_CHANGES");
  }

  const { data: row, error } = await admin
    .from("custom_fields")
    .update(patch)
    .eq("id", parsed.data.id)
    .select()
    .single();

  if (error || !row) {
    return fail<CustomField>(
      "Failed to update field: " + error?.message,
      error?.code
    );
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "custom_field.updated",
    resource_type: "custom_field",
    resource_id: parsed.data.id,
    metadata: { fields: Object.keys(patch) },
  });

  revalidatePath("/admin/custom-fields");
  return ok(row as CustomField);
}
