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
 * Deletes a rule. order_rule_applications.rule_id is ON DELETE RESTRICT
 * so rules with audit history can't be hard-deleted — admin
 * deactivates via updateRule({ id, active: false }) instead.
 *
 * Scopes, codes, code-customer junctions, customer-usage, and
 * offer-memberships all CASCADE DELETE on rule deletion.
 */
export async function deleteRule(
  input: z.input<typeof Schema>
): Promise<Result<{ id: string }>> {
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
  const { error } = await admin.from("rules").delete().eq("id", parsed.data.id);
  if (error) {
    if (error.code === "23503") {
      return fail(
        "Ο κανόνας έχει χρησιμοποιηθεί σε παραγγελίες — απενεργοποιήστε τον αντί να τον διαγράψετε.",
        "RULE_IN_USE"
      );
    }
    return fail("Failed to delete rule: " + error.message, error.code);
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "rule.deleted",
    resource_type: "rule",
    resource_id: parsed.data.id,
  });

  revalidatePath("/admin/discounts");
  return ok({ id: parsed.data.id });
}
