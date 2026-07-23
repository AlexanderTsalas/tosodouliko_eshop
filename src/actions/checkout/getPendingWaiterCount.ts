"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  session_id: z.string().uuid(),
});

/**
 * Returns the count of pending soft_waits behind a given checkout_session,
 * using the admin client. Needed because soft_waits SELECT RLS scopes rows
 * to the row's customer — the holder of the parent session can't see the
 * waiters' rows directly, so a client-side count() always returns 0 for
 * non-admin holders.
 *
 * Ownership check: the caller must own the session being queried, otherwise
 * they could probe any other session's queue length.
 */
export async function getPendingWaiterCount(
  input: z.input<typeof Schema>
): Promise<Result<{ count: number }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<{ count: number }>("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<{ count: number }>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  const { data: custRow } = await admin
    .from("customers")
    .select("id")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  const customerId = (custRow as { id: string } | null)?.id ?? null;
  if (!customerId) return fail<{ count: number }>("Missing customer profile", "NO_CUSTOMER");

  const { data: sessionRow } = await admin
    .from("cart_checkout_sessions")
    .select("customer_id")
    .eq("id", parsed.data.session_id)
    .maybeSingle();
  const owner = (sessionRow as { customer_id: string } | null)?.customer_id ?? null;
  if (owner !== customerId) return fail<{ count: number }>("Forbidden", "FORBIDDEN");

  const { count } = await admin
    .from("soft_waits")
    .select("id", { count: "exact", head: true })
    .eq("checkout_session_id", parsed.data.session_id)
    .is("promoted_at", null);

  return ok({ count: count ?? 0 });
}
