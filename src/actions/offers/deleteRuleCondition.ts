"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ id: z.string().uuid() });

export async function deleteRuleCondition(
  input: z.input<typeof Schema>
): Promise<Result<{ id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:discounts"))) {
    return fail("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("rule_conditions")
    .select("rule_id, kind")
    .eq("id", parsed.data.id)
    .maybeSingle();

  const { error } = await admin
    .from("rule_conditions")
    .delete()
    .eq("id", parsed.data.id);
  if (error) return fail(error.message, error.code);

  if (existing) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "rule.condition_deleted",
      resource_type: "rule",
      resource_id: (existing as { rule_id: string }).rule_id,
      metadata: {
        condition_id: parsed.data.id,
        kind: (existing as { kind: string }).kind,
      },
    });
  }

  revalidatePath("/admin/discounts");
  return ok({ id: parsed.data.id });
}
