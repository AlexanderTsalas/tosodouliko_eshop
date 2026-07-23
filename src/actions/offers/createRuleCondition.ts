"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { RuleCondition } from "@/types/offers";
import { CONFIG_SCHEMAS } from "./_conditionConfigSchemas";

const Schema = z.object({
  rule_id: z.string().uuid(),
  kind: z.enum([
    "timeframe",
    "user_type",
    "min_subtotal",
    "min_item_count",
    "available_quantity",
  ]),
  config: z.record(z.unknown()),
});

export async function createRuleCondition(
  input: z.input<typeof Schema>
): Promise<Result<RuleCondition>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<RuleCondition>(
      "Invalid input: " + parsed.error.message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:discounts"))) {
    return fail<RuleCondition>("Forbidden", "FORBIDDEN");
  }

  // Validate the per-kind config shape.
  const configSchema = CONFIG_SCHEMAS[parsed.data.kind];
  const configParsed = configSchema.safeParse(parsed.data.config);
  if (!configParsed.success) {
    return fail<RuleCondition>(
      `Invalid ${parsed.data.kind} config: ` + configParsed.error.message,
      "INVALID_CONFIG"
    );
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user)
    return fail<RuleCondition>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("rule_conditions")
    .insert({
      rule_id: parsed.data.rule_id,
      kind: parsed.data.kind,
      config: configParsed.data,
    })
    .select()
    .single();

  if (error || !row) {
    return fail<RuleCondition>(
      "Failed to create condition: " + error?.message,
      error?.code
    );
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "rule.condition_created",
    resource_type: "rule",
    resource_id: parsed.data.rule_id,
    metadata: { kind: parsed.data.kind },
  });

  revalidatePath("/admin/discounts");
  return ok(row as RuleCondition);
}
