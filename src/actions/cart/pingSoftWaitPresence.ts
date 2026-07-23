"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  /**
   * Optional. If omitted, the action bumps last_seen_at on EVERY pending
   * soft_wait the customer currently owns — cheap and lets a single ping
   * cover a customer waiting on multiple variants.
   */
  soft_wait_id: z.string().uuid().optional(),
});

/**
 * Bumps `soft_waits.last_seen_at` for the calling customer's pending queue
 * row(s). Frontend invokes this every ~30s while the customer's cart page
 * shows a "waiting" badge. When pings stop, the abandonment reaper
 * (reap_abandoned_soft_waits, cron-scheduled) removes the row and
 * recomputes the holder's contention timer.
 */
export async function pingSoftWaitPresence(
  input: z.input<typeof Schema>
): Promise<Result<{ updated: number }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<{ updated: number }>("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<{ updated: number }>("Not authenticated", "UNAUTHENTICATED");
  const userId = authData.user.id;

  const admin = createAdminClient();
  const { data: custRow } = await admin
    .from("customers")
    .select("id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  const customerId = (custRow as { id: string } | null)?.id ?? null;
  if (!customerId) return fail<{ updated: number }>("Missing customer profile", "NO_CUSTOMER");

  let q = admin
    .from("soft_waits")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("customer_id", customerId)
    .is("promoted_at", null);
  if (parsed.data.soft_wait_id) q = q.eq("id", parsed.data.soft_wait_id);

  const { data } = await q.select("id");
  return ok({ updated: (data ?? []).length });
}
