"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ id: z.string().uuid() });

export async function deleteFeeRule(
  input: z.input<typeof Schema>
): Promise<Result<{ id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<{ id: string }>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:fees"))) {
    return fail<{ id: string }>("Forbidden", "FORBIDDEN");
  }
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<{ id: string }>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("fee_rules")
    .select("id, fee_category_id, scope_type, amount")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (!row) return fail<{ id: string }>("Rule not found", "NOT_FOUND");

  const { error } = await admin.from("fee_rules").delete().eq("id", parsed.data.id);
  if (error) return fail<{ id: string }>(error.message, error.code);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "fee_rule.deleted",
    resource_type: "fee_rule",
    resource_id: parsed.data.id,
    metadata: {
      category_id: (row as { fee_category_id: string }).fee_category_id,
      scope: (row as { scope_type: string }).scope_type,
      amount: (row as { amount: number }).amount,
    },
  });
  revalidatePath("/admin/settings/fees");
  return ok({ id: parsed.data.id });
}
