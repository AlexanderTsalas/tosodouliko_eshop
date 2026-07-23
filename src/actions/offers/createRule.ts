"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { Rule } from "@/types/offers";
import { ACTION_CONFIG_SCHEMAS } from "./_actionConfigSchemas";

const ScopeSpec = z.object({
  scope_kind: z.enum(["all", "category", "product", "variant"]),
  resource_id: z.string().uuid().nullable().optional(),
});

/**
 * Creates a rule + its initial action + initial scopes + initial
 * memberships in an atomic flow. The action shape is required since
 * a rule without an action is meaningless.
 */
const Schema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),

  action: z.object({
    kind: z.enum([
      "price_discount",
      "product_bundle",
      "service_cost_exception",
    ]),
    config: z.record(z.unknown()),
  }),

  stacking_mode: z
    .enum(["stack", "exclusive_within_kind", "global_exclusive"])
    .default("exclusive_within_kind"),
  priority: z.number().int().default(0),

  scopes: z.array(ScopeSpec).min(1, "At least one scope is required"),
  offer_ids: z.array(z.string().uuid()).default([]),
});

export async function createRule(
  input: z.input<typeof Schema>
): Promise<Result<Rule>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<Rule>(
      "Invalid input: " + parsed.error.message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:discounts"))) {
    return fail<Rule>("Forbidden", "FORBIDDEN");
  }

  // Validate the action config shape before any DB writes.
  const cfgSchema = ACTION_CONFIG_SCHEMAS[parsed.data.action.kind];
  const cfgParsed = cfgSchema.safeParse(parsed.data.action.config);
  if (!cfgParsed.success) {
    return fail<Rule>(
      `Invalid ${parsed.data.action.kind} config: ` + cfgParsed.error.message,
      "INVALID_CONFIG"
    );
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<Rule>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  const data = parsed.data;

  const { data: ruleRow, error: ruleErr } = await admin
    .from("rules")
    .insert({
      name: data.name,
      description: data.description ?? null,
      active: false, // Q6 default
      kind: data.action.kind,
      requires_code: false,
      stacking_mode: data.stacking_mode,
      priority: data.priority,
    })
    .select()
    .single();

  if (ruleErr || !ruleRow) {
    return fail<Rule>(
      "Failed to create rule: " + ruleErr?.message,
      ruleErr?.code
    );
  }
  const rule = ruleRow as Rule;

  // Action — created in lockstep. If this fails, rollback the rule.
  const { error: actErr } = await admin.from("rule_actions").insert({
    rule_id: rule.id,
    kind: data.action.kind,
    config: cfgParsed.data,
  });
  if (actErr) {
    await admin.from("rules").delete().eq("id", rule.id);
    return fail<Rule>(
      "Failed to create rule action: " + actErr.message,
      actErr.code
    );
  }

  // Scopes.
  const { error: scopesErr } = await admin.from("rule_scopes").insert(
    data.scopes.map((s) => ({
      rule_id: rule.id,
      scope_kind: s.scope_kind,
      resource_id: s.scope_kind === "all" ? null : (s.resource_id ?? null),
    }))
  );
  if (scopesErr) {
    await admin.from("rules").delete().eq("id", rule.id);
    return fail<Rule>(
      "Failed to create rule scopes: " + scopesErr.message,
      scopesErr.code
    );
  }

  if (data.offer_ids.length > 0) {
    const { error: memberErr } = await admin
      .from("offer_rule_memberships")
      .insert(
        data.offer_ids.map((offer_id) => ({
          offer_id,
          rule_id: rule.id,
          added_by: authData.user.id,
        }))
      );
    if (memberErr) {
      await admin.from("rules").delete().eq("id", rule.id);
      return fail<Rule>(
        "Failed to assign offer memberships: " + memberErr.message,
        memberErr.code
      );
    }
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "rule.created",
    resource_type: "rule",
    resource_id: rule.id,
    metadata: { kind: data.action.kind, scopes_count: data.scopes.length },
  });

  revalidatePath("/admin/discounts");
  return ok(rule);
}
