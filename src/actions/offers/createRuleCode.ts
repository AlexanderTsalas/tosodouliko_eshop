"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { Code } from "@/types/offers";

/**
 * Legacy compat shim (v2.5). The workspace's per-rule code editor still
 * calls createRuleCode; we map it to "create a standalone code + attach
 * to the rule" so the UX appears unchanged while the data model is the
 * new standalone shape.
 */
const Schema = z.object({
  rule_id: z.string().uuid(),
  code: z.string().min(1).max(64),
  affiliate_id: z.string().uuid().nullable().optional(),
  max_uses_total: z.number().int().positive().nullable().optional(),
  max_uses_per_customer: z.number().int().positive().nullable().optional(),
  enforce_limits: z.boolean().default(false),
});

export async function createRuleCode(
  input: z.input<typeof Schema>
): Promise<Result<Code>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<Code>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:discounts"))) {
    return fail<Code>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<Code>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  const normalized = parsed.data.code.toUpperCase().trim();

  // Create the code (or fetch if it already exists globally).
  let code: Code;
  const { data: existing } = await admin
    .from("codes")
    .select("*")
    .eq("code", normalized)
    .maybeSingle();
  if (existing) {
    code = existing as Code;
  } else {
    const { data: inserted, error } = await admin
      .from("codes")
      .insert({
        code: normalized,
        affiliate_id: parsed.data.affiliate_id ?? null,
        active: true,
        max_uses_total: parsed.data.max_uses_total ?? null,
        max_uses_per_customer: parsed.data.max_uses_per_customer ?? null,
        enforce_limits: parsed.data.enforce_limits,
        created_by: authData.user.id,
      })
      .select()
      .single();
    if (error || !inserted) {
      return fail<Code>(
        "Failed to create code: " + error?.message,
        error?.code
      );
    }
    code = inserted as Code;
  }

  // Attach to the rule (idempotent).
  const { error: attachErr } = await admin
    .from("code_attachments")
    .upsert(
      {
        code_id: code.id,
        target_kind: "rule",
        target_id: parsed.data.rule_id,
        added_by: authData.user.id,
      },
      { onConflict: "code_id,target_kind,target_id" }
    );
  if (attachErr) {
    return fail<Code>("Failed to attach: " + attachErr.message, attachErr.code);
  }

  // Flip requires_code on the rule.
  await admin
    .from("rules")
    .update({ requires_code: true })
    .eq("id", parsed.data.rule_id);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "rule.code_created",
    resource_type: "rule",
    resource_id: parsed.data.rule_id,
    metadata: { code: normalized },
  });

  revalidatePath("/admin/discounts");
  return ok(code);
}
