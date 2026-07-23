"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  group_id: z.string().uuid(),
  field_id: z.string().uuid(),
  /** When omitted, appends at the end (max(sort_order) + 1). */
  sort_order: z.number().int().nonnegative().optional(),
});

export async function addFieldToGroup(
  input: z.input<typeof Schema>
): Promise<Result<{ group_id: string; field_id: string; sort_order: number }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:products"))) {
    return fail("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();
  let sortOrder = parsed.data.sort_order;
  if (sortOrder === undefined) {
    // Append: max(sort_order) + 1 among existing members.
    const { data: existing } = await admin
      .from("custom_field_group_members")
      .select("sort_order")
      .eq("group_id", parsed.data.group_id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    sortOrder = existing
      ? ((existing as { sort_order: number }).sort_order ?? 0) + 1
      : 0;
  }

  const { error } = await admin.from("custom_field_group_members").insert({
    group_id: parsed.data.group_id,
    field_id: parsed.data.field_id,
    sort_order: sortOrder,
  });

  if (error) {
    if (error.code === "23505") {
      return fail(
        "Το πεδίο είναι ήδη μέλος αυτής της ομάδας.",
        "ALREADY_MEMBER"
      );
    }
    return fail("Failed to add member: " + error.message, error.code);
  }

  revalidatePath("/admin/custom-fields");
  return ok({
    group_id: parsed.data.group_id,
    field_id: parsed.data.field_id,
    sort_order: sortOrder,
  });
}
