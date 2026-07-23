"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { Code } from "@/types/offers";

const Schema = z.object({
  id: z.string().uuid(),
  affiliate_id: z.string().uuid().nullable().optional(),
  max_uses_total: z.number().int().positive().nullable().optional(),
  max_uses_per_customer: z.number().int().positive().nullable().optional(),
  enforce_limits: z.boolean().optional(),
  active: z.boolean().optional(),
});

/** Legacy compat shim (v2.5) — patches a code (which is now a standalone
 *  entity in `codes`). */
export async function updateRuleCode(
  input: z.input<typeof Schema>
): Promise<Result<Code>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<Code>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:discounts"))) {
    return fail<Code>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user)
    return fail<Code>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  const { id, ...patch } = parsed.data;
  const updateFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) updateFields[k] = v;
  }
  if (Object.keys(updateFields).length === 0) {
    return fail<Code>("No fields to update", "NO_CHANGES");
  }

  const { data: row, error } = await admin
    .from("codes")
    .update(updateFields)
    .eq("id", id)
    .select()
    .single();
  if (error || !row) {
    return fail<Code>(
      "Failed to update code: " + error?.message,
      error?.code
    );
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "code.updated",
    resource_type: "code",
    resource_id: id,
    metadata: { fields_changed: Object.keys(updateFields) },
  });

  revalidatePath("/admin/discounts");
  return ok(row as Code);
}
