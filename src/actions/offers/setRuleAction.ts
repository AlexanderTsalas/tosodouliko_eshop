"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { RuleAction } from "@/types/offers";
import { ACTION_CONFIG_SCHEMAS } from "./_actionConfigSchemas";

const Schema = z.object({
  rule_id: z.string().uuid(),
  kind: z.enum(["price_discount", "product_bundle", "service_cost_exception"]),
  config: z.record(z.unknown()),
});

/**
 * Upserts the action for a rule (each rule has exactly one). Handles
 * both initial creation (no row exists) and kind/config replacement
 * (existing row updated atomically). Also syncs the denorm
 * `rules.kind` column so list rendering stays fast.
 */
export async function setRuleAction(
  input: z.input<typeof Schema>
): Promise<Result<RuleAction>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<RuleAction>(
      "Invalid input: " + parsed.error.message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:discounts"))) {
    return fail<RuleAction>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user)
    return fail<RuleAction>("Not authenticated", "UNAUTHENTICATED");

  const schema = ACTION_CONFIG_SCHEMAS[parsed.data.kind];
  const cfgParsed = schema.safeParse(parsed.data.config);
  if (!cfgParsed.success) {
    return fail<RuleAction>(
      `Invalid ${parsed.data.kind} config: ` + cfgParsed.error.message,
      "INVALID_CONFIG"
    );
  }

  const admin = createAdminClient();

  // Upsert by rule_id (UNIQUE constraint allows ON CONFLICT).
  const { data: row, error } = await admin
    .from("rule_actions")
    .upsert(
      {
        rule_id: parsed.data.rule_id,
        kind: parsed.data.kind,
        config: cfgParsed.data,
      },
      { onConflict: "rule_id" }
    )
    .select()
    .single();
  if (error || !row) {
    return fail<RuleAction>(
      "Failed to set rule action: " + error?.message,
      error?.code
    );
  }

  // Sync the rules.kind denorm for fast list rendering.
  await admin
    .from("rules")
    .update({ kind: parsed.data.kind })
    .eq("id", parsed.data.rule_id);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "rule.action_set",
    resource_type: "rule",
    resource_id: parsed.data.rule_id,
    metadata: { kind: parsed.data.kind },
  });

  revalidatePath("/admin/discounts");
  return ok(row as RuleAction);
}
