"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type {
  CustomFieldBinding,
  CustomFieldScopeKind,
} from "@/types/custom-fields";

const Schema = z
  .object({
    field_id: z.string().uuid().nullable().optional(),
    group_id: z.string().uuid().nullable().optional(),
    scope_kind: z.enum(["product", "variant"]),
    scope_resource_id: z.string().uuid(),
    override_required: z.boolean().nullable().optional(),
  })
  .refine((d) => (d.field_id ? !d.group_id : !!d.group_id), {
    message: "Exactly one of field_id or group_id must be set",
  });

/**
 * Convenience wrapper around createCustomFieldBinding used by the
 * product editor's "Πεδία πελάτη" tab. Same row shape; we only restrict
 * scope to 'product' or 'variant' here (category scope is managed in
 * the library bench).
 *
 * The DB constraint `uniq_field_binding_per_scope` (and the matching
 * group-binding one) ensures you can't bind the same field/group to
 * the same product/variant twice; we map 23505 → DUPLICATE_BINDING.
 */
export async function createBindingForProductScope(
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
      scope_kind: parsed.data.scope_kind satisfies CustomFieldScopeKind,
      scope_resource_id: parsed.data.scope_resource_id,
      active: true,
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

  revalidatePath("/admin/custom-fields");
  return ok(row as CustomFieldBinding);
}
