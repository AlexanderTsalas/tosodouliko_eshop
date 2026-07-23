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
 * Hard-delete a provider config. Refuses if the target is currently active —
 * the admin must promote a different provider first, which prevents the
 * "no provider configured" silent-noop window.
 */
export async function deleteEmailProvider(
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
  const { data: row } = await admin
    .from("email_provider_configs")
    .select("id, is_active, display_name")
    .eq("id", parsed.data.provider_id)
    .maybeSingle();
  if (!row) return fail<{ provider_id: string }>("Provider not found", "NOT_FOUND");
  if ((row as { is_active: boolean }).is_active) {
    return fail<{ provider_id: string }>(
      "Δεν διαγράφεται ενεργός πάροχος. Ενεργοποιήστε άλλον πρώτα.",
      "IS_ACTIVE"
    );
  }

  const { error } = await admin
    .from("email_provider_configs")
    .delete()
    .eq("id", parsed.data.provider_id);
  if (error) return fail<{ provider_id: string }>(error.message, error.code);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "email_provider.deleted",
    resource_type: "email_provider_config",
    resource_id: parsed.data.provider_id,
    metadata: { display_name: (row as { display_name: string }).display_name },
  });

  revalidatePath("/admin/settings/email");
  return ok({ provider_id: parsed.data.provider_id });
}
