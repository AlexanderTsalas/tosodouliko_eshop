"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission, requireMFA } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  session_id: z.string().uuid(),
});

/**
 * Phase 10 admin force-release: bypasses the customer-driven release path
 * (heartbeat / unload) and explicitly releases a soft session. Used by
 * the inventory-debug page when state looks corrupted or a customer
 * support intervention is needed. Audit-logged with the admin's user id.
 */
export async function forceReleaseSoftSession(
  input: z.input<typeof Schema>
): Promise<Result<{ released: boolean }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ released: boolean }>(parsed.error.issues[0].message, "INVALID_INPUT");
  }
  await requirePermission("manage:orders");
  await requireMFA();

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<{ released: boolean }>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  const { data: rpcRes, error } = await admin.rpc("release_soft_session" as never, {
    p_session_id: parsed.data.session_id,
  } as never);
  if (error) return fail<{ released: boolean }>(error.message, error.code);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "inventory_debug.soft_session_force_released",
    resource_type: "cart_checkout_session",
    resource_id: parsed.data.session_id,
  });

  revalidatePath("/admin/inventory-debug");
  return ok({ released: Boolean(rpcRes) });
}
