"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { RuleCondition } from "@/types/offers";

const Schema = z.object({
  id: z.string().uuid(),
  config: z.record(z.unknown()),
});

/** Updates only the config jsonb. The `kind` is immutable (delete + re-add
 *  to change kind, since kind affects allowed config shape). */
export async function updateRuleCondition(
  input: z.input<typeof Schema>
): Promise<Result<RuleCondition>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<RuleCondition>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:discounts"))) {
    return fail<RuleCondition>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user)
    return fail<RuleCondition>("Not authenticated", "UNAUTHENTICATED");

  // Validate against the existing row's kind.
  const admin = createAdminClient();
  const { data: existing, error: getErr } = await admin
    .from("rule_conditions")
    .select("kind, rule_id")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (getErr || !existing) {
    return fail<RuleCondition>(
      "Condition not found",
      "NOT_FOUND"
    );
  }

  const { CONFIG_SCHEMAS } = await import("./_conditionConfigSchemas");
  const configSchema = CONFIG_SCHEMAS[
    (existing as { kind: keyof typeof CONFIG_SCHEMAS }).kind
  ];
  const configParsed = configSchema.safeParse(parsed.data.config);
  if (!configParsed.success) {
    return fail<RuleCondition>(
      "Invalid config: " + configParsed.error.message,
      "INVALID_CONFIG"
    );
  }

  const { data: row, error } = await admin
    .from("rule_conditions")
    .update({ config: configParsed.data })
    .eq("id", parsed.data.id)
    .select()
    .single();
  if (error || !row) {
    return fail<RuleCondition>(
      "Failed to update condition: " + error?.message,
      error?.code
    );
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "rule.condition_updated",
    resource_type: "rule",
    resource_id: (existing as { rule_id: string }).rule_id,
    metadata: { condition_id: parsed.data.id },
  });

  revalidatePath("/admin/discounts");
  return ok(row as RuleCondition);
}
