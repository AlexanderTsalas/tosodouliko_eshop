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
 * Sets the given config row as the active one for its carrier. Deactivates
 * any sibling row in the same carrier first so the partial unique index
 * (one_active_carrier_provider_per_carrier) doesn't reject the update.
 */
export async function setActiveCarrierProvider(
  input: z.input<typeof Schema>
): Promise<Result<{ id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<{ id: string }>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:couriers"))) {
    return fail<{ id: string }>("Forbidden", "FORBIDDEN");
  }
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<{ id: string }>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("carrier_provider_configs")
    .select("id, carrier, secrets_encrypted")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (!target) return fail<{ id: string }>("Provider config not found", "NOT_FOUND");
  const conf = target as {
    id: string;
    carrier: string;
    secrets_encrypted: string | null;
  };
  if (!conf.secrets_encrypted) {
    return fail<{ id: string }>(
      "Αποθηκεύστε credentials πριν την ενεργοποίηση.",
      "MISSING_SECRETS"
    );
  }

  // Deactivate all sibling rows under the same carrier first.
  const { error: deactErr } = await admin
    .from("carrier_provider_configs")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("carrier", conf.carrier)
    .neq("id", conf.id);
  if (deactErr) return fail<{ id: string }>(deactErr.message, deactErr.code);

  const { error: actErr } = await admin
    .from("carrier_provider_configs")
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq("id", conf.id);
  if (actErr) return fail<{ id: string }>(actErr.message, actErr.code);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "carrier_provider.activated",
    resource_type: "carrier_provider_config",
    resource_id: conf.id,
    metadata: { carrier: conf.carrier },
  });
  revalidatePath("/admin/settings/couriers");
  return ok({ id: conf.id });
}
