"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  code_id: z.string().uuid(),
  target_kind: z.enum(["rule", "offer"]),
  target_id: z.string().uuid(),
});

export async function detachCode(
  input: z.input<typeof Schema>
): Promise<Result<{ removed: boolean }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:discounts"))) {
    return fail("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  const { error, count } = await admin
    .from("code_attachments")
    .delete({ count: "exact" })
    .eq("code_id", parsed.data.code_id)
    .eq("target_kind", parsed.data.target_kind)
    .eq("target_id", parsed.data.target_id);
  if (error) return fail(error.message, error.code);

  // After detach, requires_code on affected rules might need to flip
  // back to false. Recompute: a rule still requires a code iff any
  // code is attached directly OR to one of its parent offers.
  await recomputeRequiresCode(admin, parsed.data.target_kind, parsed.data.target_id);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "code.detached",
    resource_type: "code",
    resource_id: parsed.data.code_id,
    metadata: {
      target_kind: parsed.data.target_kind,
      target_id: parsed.data.target_id,
    },
  });

  revalidatePath("/admin/discounts");
  return ok({ removed: (count ?? 0) > 0 });
}

async function recomputeRequiresCode(
  admin: ReturnType<typeof createAdminClient>,
  target_kind: "rule" | "offer",
  target_id: string
): Promise<void> {
  // Build the set of affected rule IDs.
  const ruleIds: string[] = [];
  if (target_kind === "rule") {
    ruleIds.push(target_id);
  } else {
    const { data: members } = await admin
      .from("offer_rule_memberships")
      .select("rule_id")
      .eq("offer_id", target_id);
    for (const m of (members ?? []) as Array<{ rule_id: string }>) {
      ruleIds.push(m.rule_id);
    }
  }
  if (ruleIds.length === 0) return;

  // For each, query whether any code remains attached (direct + via offer).
  for (const ruleId of ruleIds) {
    const { data: directAttach } = await admin
      .from("code_attachments")
      .select("id")
      .eq("target_kind", "rule")
      .eq("target_id", ruleId)
      .limit(1);
    const directExists = (directAttach ?? []).length > 0;

    let viaOfferExists = false;
    if (!directExists) {
      const { data: parents } = await admin
        .from("offer_rule_memberships")
        .select("offer_id")
        .eq("rule_id", ruleId);
      const offerIds = ((parents ?? []) as Array<{ offer_id: string }>).map(
        (p) => p.offer_id
      );
      if (offerIds.length > 0) {
        const { data: offerAttach } = await admin
          .from("code_attachments")
          .select("id")
          .eq("target_kind", "offer")
          .in("target_id", offerIds)
          .limit(1);
        viaOfferExists = (offerAttach ?? []).length > 0;
      }
    }

    await admin
      .from("rules")
      .update({ requires_code: directExists || viaOfferExists })
      .eq("id", ruleId);
  }
}
