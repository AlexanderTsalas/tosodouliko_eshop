"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const ScopeSpec = z.object({
  scope_kind: z.enum(["all", "category", "product", "variant"]),
  resource_id: z.string().uuid().nullable().optional(),
});

const Schema = z.object({
  rule_id: z.string().uuid(),
  scopes: z.array(ScopeSpec).min(1, "At least one scope is required"),
});

/** Replaces the FULL scope set for a rule (delete-all-then-insert).
 *  Race window same as v1: <50ms between delete + insert; not worth a
 *  transactional RPC at this point. */
export async function setRuleScopes(
  input: z.input<typeof Schema>
): Promise<Result<{ rule_id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:discounts"))) {
    return fail("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  const { rule_id, scopes } = parsed.data;

  const { error: delErr } = await admin
    .from("rule_scopes")
    .delete()
    .eq("rule_id", rule_id);
  if (delErr) {
    return fail("Failed to clear scopes: " + delErr.message, delErr.code);
  }

  const { error: insErr } = await admin.from("rule_scopes").insert(
    scopes.map((s) => ({
      rule_id,
      scope_kind: s.scope_kind,
      resource_id: s.scope_kind === "all" ? null : (s.resource_id ?? null),
    }))
  );
  if (insErr) {
    return fail("Failed to insert scopes: " + insErr.message, insErr.code);
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "rule.scopes_replaced",
    resource_type: "rule",
    resource_id: rule_id,
    metadata: { scopes_count: scopes.length },
  });

  revalidatePath("/admin/discounts");
  return ok({ rule_id });
}
