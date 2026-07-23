"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { Rule } from "@/types/offers";

/**
 * Slim updateRule (v2.4). Only patches identity + active + behaviour.
 * Action config moved to rule_actions — patch via setRuleAction.
 * Conditions live in rule_conditions — patch via updateRuleCondition.
 *
 * `kind` and `requires_code` are derived (kind = rule_actions.kind
 * denorm, requires_code = rule_codes existence) and aren't directly
 * patchable here.
 */
const Schema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),

  stacking_mode: z
    .enum(["stack", "exclusive_within_kind", "global_exclusive"])
    .optional(),
  priority: z.number().int().optional(),
});

export async function updateRule(
  input: z.input<typeof Schema>
): Promise<Result<Rule>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<Rule>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:discounts"))) {
    return fail<Rule>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<Rule>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  const { id, ...patch } = parsed.data;
  const updateFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) updateFields[k] = v;
  }
  if (Object.keys(updateFields).length === 0) {
    return fail<Rule>("No fields to update", "NO_CHANGES");
  }

  const { data: updated, error } = await admin
    .from("rules")
    .update(updateFields)
    .eq("id", id)
    .select()
    .single();

  if (error || !updated) {
    return fail<Rule>(
      "Failed to update rule: " + error?.message,
      error?.code
    );
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "rule.updated",
    resource_type: "rule",
    resource_id: id,
    metadata: { fields_changed: Object.keys(updateFields) },
  });

  revalidatePath("/admin/discounts");
  return ok(updated as Rule);
}
