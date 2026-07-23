"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { CustomFieldGroup } from "@/types/custom-fields";

const Schema = z.object({
  name_translations: z
    .record(z.string(), z.string().max(200))
    .refine((t) => typeof t.el === "string" && t.el.trim().length > 0, {
      message: "Η ελληνική ονομασία της ομάδας είναι υποχρεωτική",
    }),
  description: z.string().max(2000).nullable().optional(),
  active: z.boolean().default(true),
  /** Optional: seed the group with these field ids in this order. Used
   *  by the multi-select "create group from selected" flow. */
  initial_field_ids: z.array(z.string().uuid()).default([]),
});

/**
 * Creates a custom field group. Optionally seeds initial members in
 * one shot for the "select N fields → create group" UX.
 */
export async function createCustomFieldGroup(
  input: z.input<typeof Schema>
): Promise<Result<CustomFieldGroup>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<CustomFieldGroup>(
      "Invalid input: " + parsed.error.issues[0]?.message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<CustomFieldGroup>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<CustomFieldGroup>("Not authenticated", "UNAUTHENTICATED");
  }

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("custom_field_groups")
    .insert({
      name_translations: parsed.data.name_translations,
      description: parsed.data.description ?? null,
      active: parsed.data.active,
      created_by: authData.user.id,
    })
    .select()
    .single();

  if (error || !row) {
    return fail<CustomFieldGroup>(
      "Failed to create group: " + error?.message,
      error?.code
    );
  }

  // Seed initial members if provided.
  if (parsed.data.initial_field_ids.length > 0) {
    const memberRows = parsed.data.initial_field_ids.map((field_id, i) => ({
      group_id: (row as CustomFieldGroup).id,
      field_id,
      sort_order: i,
    }));
    await admin.from("custom_field_group_members").insert(memberRows);
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "custom_field_group.created",
    resource_type: "custom_field_group",
    resource_id: (row as CustomFieldGroup).id,
    metadata: {
      initial_members: parsed.data.initial_field_ids.length,
    },
  });

  revalidatePath("/admin/custom-fields");
  return ok(row as CustomFieldGroup);
}
