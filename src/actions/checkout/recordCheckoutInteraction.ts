"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  session_id: z.string().uuid(),
});

/**
 * Bumps `cart_checkout_sessions.last_interaction_at` to now() to reset the
 * 30-minute idle backstop. Called by the checkout page on real user
 * activity (clicks, keypresses, scrolls) — heavily throttled client-side
 * (~once per minute) so we're not hammering the DB on every keystroke.
 *
 * Distinct from heartbeat (which is automatic, every 10s, signals page is
 * alive). Interaction signals the *customer* is alive, not just the tab.
 */
export async function recordCheckoutInteraction(
  input: z.input<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<null>("Not authenticated", "UNAUTHENTICATED");
  const userId = authData.user.id;

  const admin = createAdminClient();
  const { data: custRow } = await admin
    .from("customers")
    .select("id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  const customerId = (custRow as { id: string } | null)?.id ?? null;
  if (!customerId) return fail<null>("Missing customer profile", "NO_CUSTOMER");

  await admin
    .from("cart_checkout_sessions")
    .update({ last_interaction_at: new Date().toISOString() })
    .eq("id", parsed.data.session_id)
    .eq("customer_id", customerId)
    .eq("state", "soft");

  return ok(null);
}
