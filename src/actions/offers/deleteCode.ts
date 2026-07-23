"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ id: z.string().uuid() });

/**
 * Hard-deletes a code. Attachments cascade away. The order_rule_applications
 * audit rows had their code_id repointed to ON DELETE SET NULL by
 * migration 31, so they survive (losing code attribution).
 */
export async function deleteCode(
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
    .from("codes")
    .select("code")
    .eq("id", parsed.data.id)
    .maybeSingle();

  const { error } = await admin
    .from("codes")
    .delete()
    .eq("id", parsed.data.id);
  if (error) return fail(error.message, error.code);

  // After deletion, recompute requires_code on every rule whose code-
  // attachment graph might have changed. Best-effort.
  await admin.rpc("refresh_rules_requires_code_flag");

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "code.deleted",
    resource_type: "code",
    resource_id: parsed.data.id,
    metadata: { code: (existing as { code: string } | null)?.code },
  });

  revalidatePath("/admin/discounts");
  return ok({ id: parsed.data.id });
}
