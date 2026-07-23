"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { CodeAttachment } from "@/types/offers";

const Schema = z.object({
  code_id: z.string().uuid(),
  target_kind: z.enum(["rule", "offer"]),
  target_id: z.string().uuid(),
});

/**
 * Attaches a code to a rule or offer. Idempotent — if the attachment
 * already exists, returns it unchanged.
 *
 * When attached to a rule (or to an offer that contains the rule), the
 * rule's `requires_code` denorm flag is flipped to true.
 */
export async function attachCode(
  input: z.input<typeof Schema>
): Promise<Result<CodeAttachment>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success)
    return fail<CodeAttachment>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:discounts"))) {
    return fail<CodeAttachment>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user)
    return fail<CodeAttachment>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();

  // Try insert; on conflict, fetch the existing row instead.
  const { data: existing } = await admin
    .from("code_attachments")
    .select("*")
    .eq("code_id", parsed.data.code_id)
    .eq("target_kind", parsed.data.target_kind)
    .eq("target_id", parsed.data.target_id)
    .maybeSingle();
  if (existing) {
    return ok(existing as CodeAttachment);
  }

  const { data: row, error } = await admin
    .from("code_attachments")
    .insert({
      code_id: parsed.data.code_id,
      target_kind: parsed.data.target_kind,
      target_id: parsed.data.target_id,
      added_by: authData.user.id,
    })
    .select()
    .single();
  if (error || !row) {
    return fail<CodeAttachment>(
      "Failed to attach code: " + error?.message,
      error?.code
    );
  }

  // Flip requires_code on affected rules.
  await syncRequiresCodeForAttachment(
    admin,
    parsed.data.target_kind,
    parsed.data.target_id
  );

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "code.attached",
    resource_type: "code",
    resource_id: parsed.data.code_id,
    metadata: {
      target_kind: parsed.data.target_kind,
      target_id: parsed.data.target_id,
    },
  });

  revalidatePath("/admin/discounts");
  return ok(row as CodeAttachment);
}

async function syncRequiresCodeForAttachment(
  admin: ReturnType<typeof createAdminClient>,
  target_kind: "rule" | "offer",
  target_id: string
): Promise<void> {
  if (target_kind === "rule") {
    await admin
      .from("rules")
      .update({ requires_code: true })
      .eq("id", target_id);
  } else {
    // For an offer, flip every member rule.
    const { data: members } = await admin
      .from("offer_rule_memberships")
      .select("rule_id")
      .eq("offer_id", target_id);
    const ruleIds = ((members ?? []) as Array<{ rule_id: string }>).map(
      (m) => m.rule_id
    );
    if (ruleIds.length > 0) {
      await admin
        .from("rules")
        .update({ requires_code: true })
        .in("id", ruleIds);
    }
  }
}
