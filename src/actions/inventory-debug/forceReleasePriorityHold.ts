"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission, requireMFA } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  hold_id: z.string().uuid(),
});

/**
 * Phase 10 admin force-release for a single priority_hold. Releases the
 * inventory back to available, marks the hold consumed_at = now() so the
 * reaper / queue advancement treats it as terminal, and for
 * soft_wait_promotion sources advances the queue inline.
 */
export async function forceReleasePriorityHold(
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
  const { data: holdRow } = await admin
    .from("priority_holds")
    .select("id, variant_id, quantity, source, consumed_at")
    .eq("id", parsed.data.hold_id)
    .maybeSingle();
  const hold = holdRow as
    | {
        id: string;
        variant_id: string;
        quantity: number;
        source: "soft_wait_promotion" | "wishlist_notification";
        consumed_at: string | null;
      }
    | null;
  if (!hold) return fail<{ released: boolean }>("Δεν βρέθηκε.", "NOT_FOUND");
  if (hold.consumed_at) {
    return fail<{ released: boolean }>(
      "Έχει ήδη απελευθερωθεί ή καταναλωθεί.",
      "ALREADY_TERMINAL"
    );
  }

  const { error: rpcErr } = await admin.rpc("release_priority" as never, {
    p_variant_id: hold.variant_id,
    p_qty: hold.quantity,
  } as never);
  if (rpcErr) return fail<{ released: boolean }>(rpcErr.message, rpcErr.code);

  const nowIso = new Date().toISOString();
  await admin
    .from("priority_holds")
    .update({ consumed_at: nowIso, expires_at: nowIso })
    .eq("id", hold.id);

  if (hold.source === "soft_wait_promotion") {
    await admin.rpc("advance_soft_wait_queue_after_priority_expiry" as never, {
      p_priority_hold_id: hold.id,
    } as never);
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "inventory_debug.priority_hold_force_released",
    resource_type: "priority_hold",
    resource_id: hold.id,
    metadata: {
      variant_id: hold.variant_id,
      quantity: hold.quantity,
      source: hold.source,
    },
  });

  revalidatePath("/admin/inventory-debug");
  return ok({ released: true });
}
