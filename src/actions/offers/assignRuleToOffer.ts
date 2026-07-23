"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  offer_id: z.string().uuid(),
  rule_id: z.string().uuid(),
});

/** Adds an offer→rule membership (M2M). Idempotent — re-applying a
 *  membership that already exists is a no-op (caught by the UNIQUE
 *  constraint and treated as success). */
export async function assignRuleToOffer(
  input: z.input<typeof Schema>
): Promise<Result<{ offer_id: string; rule_id: string }>> {
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
  const { error } = await admin.from("offer_rule_memberships").insert({
    offer_id: parsed.data.offer_id,
    rule_id: parsed.data.rule_id,
    added_by: authData.user.id,
  });

  if (error) {
    // 23505 = unique violation = membership already exists. Idempotent.
    if (error.code !== "23505") {
      return fail("Failed to assign rule: " + error.message, error.code);
    }
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "offer.rule_assigned",
    resource_type: "offer",
    resource_id: parsed.data.offer_id,
    metadata: { rule_id: parsed.data.rule_id },
  });

  revalidatePath("/admin/discounts");
  return ok({ offer_id: parsed.data.offer_id, rule_id: parsed.data.rule_id });
}
