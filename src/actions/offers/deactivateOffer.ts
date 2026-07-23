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
 * Soft-deactivate an offer by setting active=false.
 *
 * In v2 this cascades to all rules under the offer via the engine's
 * OR-of-parents check — any rule that ONLY belongs to this offer
 * effectively goes offline. Rules that belong to other still-active
 * offers continue to apply.
 *
 * order_rule_applications.offer_id has ON DELETE RESTRICT so an offer
 * with historical use can't be hard-deleted. Soft-deactivate is the
 * universal safe path. A future cleanup action could permit hard-
 * delete for offers with no audit references (current_uses=0 across
 * all member rules).
 */
export async function deactivateOffer(
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
  const { error } = await admin
    .from("offers")
    .update({ active: false })
    .eq("id", parsed.data.id);

  if (error) {
    return fail(
      "Failed to deactivate offer: " + error.message,
      error.code
    );
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "offer.deactivated",
    resource_type: "offer",
    resource_id: parsed.data.id,
  });

  revalidatePath("/admin/discounts");
  return ok({ id: parsed.data.id });
}
