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

/** Removes an offer↔rule membership. The rule itself stays; it just
 *  loses this particular offer parent. If the rule still has other
 *  parents, it continues to apply per their active flags. If this was
 *  the rule's only parent, the rule becomes "orphan" and applies based
 *  solely on its own active flag. */
export async function unassignRuleFromOffer(
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
  const { error } = await admin
    .from("offer_rule_memberships")
    .delete()
    .eq("offer_id", parsed.data.offer_id)
    .eq("rule_id", parsed.data.rule_id);

  if (error) {
    return fail("Failed to unassign rule: " + error.message, error.code);
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "offer.rule_unassigned",
    resource_type: "offer",
    resource_id: parsed.data.offer_id,
    metadata: { rule_id: parsed.data.rule_id },
  });

  revalidatePath("/admin/discounts");
  return ok({ offer_id: parsed.data.offer_id, rule_id: parsed.data.rule_id });
}
