"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { releaseCustomerPriorityHolds } from "@/lib/inventory/releaseCustomerPriorityHolds";
import { logAuditEvent } from "@/lib/audit-log";

/**
 * Phase 10 §16.6 — sign-out is cancel-everything.
 *
 * Before invalidating the auth session, sweep the customer's open
 * inventory commitments: release any active priority holds, delete any
 * pending soft_wait rows, and mark any active soft sessions 'released'.
 * Rationale: the customer is leaving and their claims shouldn't keep
 * blocking other shoppers.
 *
 * Soft sessions for an authenticated user belong to the same customer_id
 * the holds reference, so the same lookup applies. Best-effort cleanup;
 * errors are logged but never block the sign-out itself.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id ?? null;

  if (userId) {
    try {
      const admin = createAdminClient();
      const { data: custRow } = await admin
        .from("customers")
        .select("id")
        .eq("auth_user_id", userId)
        .maybeSingle();
      const customerId = (custRow as { id: string } | null)?.id;
      if (customerId) {
        const releaseResult = await releaseCustomerPriorityHolds({
          customer_id: customerId,
        });

        // Drop any pending soft_wait queue memberships — they reference
        // checkout_session_ids we're no longer interested in.
        await admin
          .from("soft_waits")
          .delete()
          .eq("customer_id", customerId)
          .is("promoted_at", null);

        // Release any active soft sessions. The reaper would catch these
        // within 60s via heartbeat staleness, but a clean explicit sweep
        // is more correct and immediate.
        const { data: sessRows } = await admin
          .from("cart_checkout_sessions")
          .select("id")
          .eq("customer_id", customerId)
          .eq("state", "soft");
        const sessions = (sessRows ?? []) as Array<{ id: string }>;
        for (const s of sessions) {
          await admin.rpc("release_soft_session" as never, {
            p_session_id: s.id,
          } as never);
        }

        await logAuditEvent({
          actor_id: userId,
          actor_type: "user",
          action: "auth.signout_sweep",
          resource_type: "user",
          resource_id: userId,
          metadata: {
            priority_holds_released: releaseResult.released,
            soft_sessions_released: sessions.length,
          },
        });
      }
    } catch (err) {
      console.error(
        `[signOut] sweep failed for user ${userId}: ${(err as Error).message}`
      );
    }
  }

  await supabase.auth.signOut();
  // Scope down from the previous `revalidatePath("/", "layout")` which
  // flushed every cached RSC payload site-wide on every sign-out. Only
  // the account + admin segments carry per-session content; storefront
  // pages don't change shape between signed-in and signed-out states.
  revalidatePath("/account", "layout");
  revalidatePath("/admin", "layout");
}
