"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ provider_id: z.string().uuid() });

/**
 * Promote one provider to "active" and demote all others. The DB enforces
 * "at most one active" via a partial unique index, so we ALWAYS demote
 * everything else first (in the same logical pass) before promoting the
 * target row. Two separate UPDATEs because Supabase doesn't expose
 * transactions to PostgREST, but the index keeps us correct under retry.
 */
export async function setActiveProvider(
  input: z.input<typeof Schema>
): Promise<Result<{ provider_id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<{ provider_id: string }>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:settings"))) {
    return fail<{ provider_id: string }>("Forbidden", "FORBIDDEN");
  }
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<{ provider_id: string }>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();

  // Target row must exist and must have a stored secret — activating an
  // empty config would just produce silent send failures.
  const { data: target } = await admin
    .from("email_provider_configs")
    .select("id, secrets_encrypted, display_name")
    .eq("id", parsed.data.provider_id)
    .maybeSingle();
  if (!target) {
    return fail<{ provider_id: string }>("Provider not found", "NOT_FOUND");
  }
  if (!(target as { secrets_encrypted: unknown }).secrets_encrypted) {
    return fail<{ provider_id: string }>(
      "Δεν έχει αποθηκευτεί secret για αυτόν τον πάροχο. Επεξεργαστείτε και αποθηκεύστε το password / API key πρώτα.",
      "MISSING_SECRET"
    );
  }

  const now = new Date().toISOString();

  // Demote everyone else first.
  const { error: deErr } = await admin
    .from("email_provider_configs")
    .update({ is_active: false, updated_at: now })
    .eq("is_active", true)
    .neq("id", parsed.data.provider_id);
  if (deErr) return fail<{ provider_id: string }>(deErr.message, deErr.code);

  // Promote the target.
  const { error: prErr } = await admin
    .from("email_provider_configs")
    .update({ is_active: true, updated_at: now })
    .eq("id", parsed.data.provider_id);
  if (prErr) return fail<{ provider_id: string }>(prErr.message, prErr.code);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "email_provider.activated",
    resource_type: "email_provider_config",
    resource_id: parsed.data.provider_id,
    metadata: { display_name: (target as { display_name: string }).display_name },
  });

  revalidatePath("/admin/settings/email");
  return ok({ provider_id: parsed.data.provider_id });
}
