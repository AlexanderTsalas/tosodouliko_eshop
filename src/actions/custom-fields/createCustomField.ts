"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type {
  CustomField,
  CustomFieldDataType,
  CustomFieldEditPolicy,
} from "@/types/custom-fields";

const Schema = z.object({
  key: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z][a-z0-9_]*$/, {
      message:
        "Το key πρέπει να αρχίζει με γράμμα και να περιέχει μόνο πεζά, αριθμούς, _",
    }),
  // Open record so callers can pass any locale; we enforce that el is
  // present + non-empty via refine.
  label_translations: z
    .record(z.string(), z.string().max(200))
    .refine((t) => typeof t.el === "string" && t.el.trim().length > 0, {
      message: "Η ελληνική ετικέτα είναι υποχρεωτική",
    }),
  data_type: z.enum(["text", "number", "boolean", "dropdown", "multi_select"]),
  required_default: z.boolean().default(false),
  visible: z.boolean().default(true),
  per_unit: z.boolean().default(false),
  validation: z.record(z.string(), z.unknown()).default({}),
  edit_policy: z
    .enum(["frozen", "admin_until_dispatch"])
    .default("frozen"),
});

/**
 * Creates a custom field in the library.
 *
 * For boolean fields, seeds two value rows (true / false) automatically
 * with no modifiers — the admin can edit them afterwards. Other
 * deterministic types (dropdown, multi_select) start with no values;
 * the admin adds options via createCustomFieldValue.
 *
 * Text and number fields never have values (their validation lives on
 * the field row's `validation` jsonb).
 */
export async function createCustomField(
  input: z.input<typeof Schema>
): Promise<Result<CustomField>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<CustomField>(
      "Invalid input: " + parsed.error.issues[0]?.message,
      "INVALID_INPUT"
    );
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
  const { data: row, error } = await admin
    .from("custom_fields")
    .insert({
      key: parsed.data.key,
      label_translations: parsed.data.label_translations,
      data_type: parsed.data.data_type,
      required_default: parsed.data.required_default,
      visible: parsed.data.visible,
      per_unit: parsed.data.per_unit,
      validation: parsed.data.validation,
      edit_policy: parsed.data.edit_policy,
      created_by: authData.user.id,
    })
    .select()
    .single();

  if (error || !row) {
    if (error?.code === "23505") {
      return fail<CustomField>(
        "Το key χρησιμοποιείται ήδη από άλλο πεδίο.",
        "DUPLICATE_KEY"
      );
    }
    return fail<CustomField>(
      "Failed to create field: " + error?.message,
      error?.code
    );
  }

  // Seed boolean true/false rows so the field is usable immediately.
  if (parsed.data.data_type === "boolean") {
    await admin.from("custom_field_values").insert([
      {
        field_id: (row as CustomField).id,
        value: true,
        label_translations: { el: "Ναι", en: "Yes" },
        modifier_kind: "none",
        modifier_amount: 0,
        sort_order: 0,
      },
      {
        field_id: (row as CustomField).id,
        value: false,
        label_translations: { el: "Όχι", en: "No" },
        modifier_kind: "none",
        modifier_amount: 0,
        sort_order: 1,
      },
    ]);
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "custom_field.created",
    resource_type: "custom_field",
    resource_id: (row as CustomField).id,
    metadata: {
      key: parsed.data.key,
      data_type: parsed.data.data_type as CustomFieldDataType,
      edit_policy: parsed.data.edit_policy as CustomFieldEditPolicy,
    },
  });

  revalidatePath("/admin/custom-fields");
  return ok(row as CustomField);
}
