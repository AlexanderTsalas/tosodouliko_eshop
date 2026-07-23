"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ id: z.string().uuid() });

export async function deleteCarrierProvider(
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
  const { data: row } = await admin
    .from("carrier_provider_configs")
    .select("id, carrier, display_name, is_active")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (!row) return fail<{ id: string }>("Provider config not found", "NOT_FOUND");
  const conf = row as {
    id: string;
    carrier: string;
    display_name: string;
    is_active: boolean;
  };
  if (conf.is_active) {
    return fail<{ id: string }>(
      "Δεν διαγράφεται η ενεργή ρύθμιση. Απενεργοποιήστε την πρώτα.",
      "IS_ACTIVE"
    );
  }

  const { error } = await admin
    .from("carrier_provider_configs")
    .delete()
    .eq("id", parsed.data.id);
  if (error) return fail<{ id: string }>(error.message, error.code);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "carrier_provider.deleted",
    resource_type: "carrier_provider_config",
    resource_id: parsed.data.id,
    metadata: { carrier: conf.carrier, display_name: conf.display_name },
  });
  revalidatePath("/admin/settings/couriers");
  return ok({ id: parsed.data.id });
}
