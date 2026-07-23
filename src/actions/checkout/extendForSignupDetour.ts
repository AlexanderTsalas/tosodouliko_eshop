"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  session_id: z.string().uuid(),
});

/**
 * Bumps the contention timer by +5 minutes when the holder detours to the
 * signup form. One-shot per session (the DB function enforces idempotency
 * via signup_detour_at). Called by the cart-click prompt's "Δημιουργία
 * λογαριασμού" branch BEFORE navigating to /auth/signup so the timer
 * extension is in place before the page transition starts.
 *
 * Returns:
 *   bumped=true  → the extension applied (first detour for this session)
 *   bumped=false → the session was already detoured, or not in soft state,
 *                  or not found. Caller treats both as "ok to proceed" —
 *                  the customer should still be allowed to detour even if
 *                  the bump already happened; we just don't double-extend.
 */
export async function extendForSignupDetour(
  input: z.input<typeof Schema>
): Promise<Result<{ bumped: boolean }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ bumped: boolean }>("Invalid input", "INVALID_INPUT");
  }

  // Auth check: only the session owner can extend their own timer. The
  // admin client bypasses RLS for the RPC call itself, but we double-check
  // ownership against the customer row.
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<{ bumped: boolean }>("Not authenticated", "UNAUTHENTICATED");
  }
  const userId = authData.user.id;

  const admin = createAdminClient();
  const { data: custRow } = await admin
    .from("customers")
    .select("id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  const customerId = (custRow as { id: string } | null)?.id ?? null;
  if (!customerId) {
    return fail<{ bumped: boolean }>("Missing customer profile", "NO_CUSTOMER");
  }

  // Ownership gate.
  const { data: sessRow } = await admin
    .from("cart_checkout_sessions")
    .select("id, customer_id")
    .eq("id", parsed.data.session_id)
    .maybeSingle();
  const session = sessRow as { id: string; customer_id: string } | null;
  if (!session || session.customer_id !== customerId) {
    return fail<{ bumped: boolean }>("Δεν βρέθηκε η συνεδρία.", "SESSION_NOT_FOUND");
  }

  const { data: result, error } = await admin.rpc(
    "extend_for_signup_detour" as never,
    { p_session_id: parsed.data.session_id } as never
  );
  if (error) {
    return fail<{ bumped: boolean }>(error.message, error.code);
  }
  return ok({ bumped: Boolean(result) });
}
