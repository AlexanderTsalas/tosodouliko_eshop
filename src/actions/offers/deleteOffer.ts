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
 * Hard-deletes an offer.
 *
 * Behaviour per the user's spec:
 *   - The offer row goes away
 *   - offer_rule_memberships rows pointing at this offer go away (FK
 *     ON DELETE CASCADE on offer_rule_memberships.offer_id)
 *   - The rules THEMSELVES stay — they become standalone (orphan rules
 *     evaluate based on their own active flag, no parent gate)
 *   - order_rule_applications rows keep offer_id pointing at the
 *     deleted offer; FK is ON DELETE SET NULL so the audit trail
 *     survives but loses the offer name
 */
export async function deleteOffer(
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
    .from("offers")
    .select("name")
    .eq("id", parsed.data.id)
    .maybeSingle();

  const { error } = await admin
    .from("offers")
    .delete()
    .eq("id", parsed.data.id);
  if (error) return fail(error.message, error.code);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "offer.deleted",
    resource_type: "offer",
    resource_id: parsed.data.id,
    metadata: { name: (existing as { name: string } | null)?.name },
  });

  revalidatePath("/admin/discounts");
  return ok({ id: parsed.data.id });
}
