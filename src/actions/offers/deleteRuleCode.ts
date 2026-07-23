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
 * Legacy compat shim (v2.5) — removes a standalone code. Attachments
 * cascade. Affected rules' requires_code flags are recomputed.
 */
export async function deleteRuleCode(
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

  const { data: directAttach } = await admin
    .from("code_attachments")
    .select("target_id")
    .eq("code_id", parsed.data.id)
    .eq("target_kind", "rule");
  const directRuleIds = (
    (directAttach ?? []) as Array<{ target_id: string }>
  ).map((r) => r.target_id);

  const { data: offerAttach } = await admin
    .from("code_attachments")
    .select("target_id")
    .eq("code_id", parsed.data.id)
    .eq("target_kind", "offer");
  const affectedOfferIds = (
    (offerAttach ?? []) as Array<{ target_id: string }>
  ).map((r) => r.target_id);

  const offerRuleIds: string[] = [];
  if (affectedOfferIds.length > 0) {
    const { data: members } = await admin
      .from("offer_rule_memberships")
      .select("rule_id")
      .in("offer_id", affectedOfferIds);
    for (const m of (members ?? []) as Array<{ rule_id: string }>) {
      offerRuleIds.push(m.rule_id);
    }
  }

  const affectedRuleIds = Array.from(
    new Set([...directRuleIds, ...offerRuleIds])
  );

  const { error } = await admin.from("codes").delete().eq("id", parsed.data.id);
  if (error) return fail(error.message, error.code);

  for (const ruleId of affectedRuleIds) {
    const { data: directRemaining } = await admin
      .from("code_attachments")
      .select("id")
      .eq("target_kind", "rule")
      .eq("target_id", ruleId)
      .limit(1);
    let stillNeeds = (directRemaining ?? []).length > 0;

    if (!stillNeeds) {
      const { data: parents } = await admin
        .from("offer_rule_memberships")
        .select("offer_id")
        .eq("rule_id", ruleId);
      const parentOfferIds = (
        (parents ?? []) as Array<{ offer_id: string }>
      ).map((p) => p.offer_id);
      if (parentOfferIds.length > 0) {
        const { data: viaOffer } = await admin
          .from("code_attachments")
          .select("id")
          .eq("target_kind", "offer")
          .in("target_id", parentOfferIds)
          .limit(1);
        stillNeeds = (viaOffer ?? []).length > 0;
      }
    }

    await admin
      .from("rules")
      .update({ requires_code: stillNeeds })
      .eq("id", ruleId);
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "code.deleted",
    resource_type: "code",
    resource_id: parsed.data.id,
  });

  revalidatePath("/admin/discounts");
  return ok({ id: parsed.data.id });
}
