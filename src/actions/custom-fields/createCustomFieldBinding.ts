"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { CustomFieldBinding } from "@/types/custom-fields";

const Schema = z
  .object({
    field_id: z.string().uuid().nullable().optional(),
    group_id: z.string().uuid().nullable().optional(),
    scope_kind: z.enum(["category", "product", "variant"]),
    scope_resource_id: z.string().uuid(),
    active: z.boolean().default(true),
    override_required: z.boolean().nullable().default(null),
  })
  .refine(
    (d) => (d.field_id ? !d.group_id : !!d.group_id),
    {
      message: "Exactly one of field_id or group_id must be set",
    }
  );

/**
 * Creates a scope binding — points a field OR a group at a category /
 * product / variant. The polymorphic XOR is enforced both client-side
 * (refine) and database-side (CHECK constraint).
 */
export async function createCustomFieldBinding(
  input: z.input<typeof Schema>
): Promise<Result<CustomFieldBinding>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<CustomFieldBinding>(
      "Invalid input: " + parsed.error.issues[0]?.message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<CustomFieldBinding>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<CustomFieldBinding>("Not authenticated", "UNAUTHENTICATED");
  }

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("custom_field_bindings")
    .insert({
      field_id: parsed.data.field_id ?? null,
      group_id: parsed.data.group_id ?? null,
      scope_kind: parsed.data.scope_kind,
      scope_resource_id: parsed.data.scope_resource_id,
      active: parsed.data.active,
      override_required: parsed.data.override_required ?? null,
      created_by: authData.user.id,
    })
    .select()
    .single();

  if (error || !row) {
    if (error?.code === "23505") {
      return fail<CustomFieldBinding>(
        "Αυτή η σύνδεση υπάρχει ήδη.",
        "DUPLICATE_BINDING"
      );
    }
    return fail<CustomFieldBinding>(
      "Failed to create binding: " + error?.message,
      error?.code
    );
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "custom_field_binding.created",
    resource_type: "custom_field_binding",
    resource_id: (row as CustomFieldBinding).id,
    metadata: {
      scope_kind: parsed.data.scope_kind,
      target: parsed.data.field_id ? "field" : "group",
    },
  });

  revalidatePath("/admin/custom-fields");
  return ok(row as CustomFieldBinding);
}
