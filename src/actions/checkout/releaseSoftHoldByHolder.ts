"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  session_id: z.string().uuid(),
});

/**
 * Holder voluntarily releases their soft hold ("Παραχώρηση σειράς"). This
 * is the "Offer turn" path in the contention banner.
 *
 * Idempotent and state-gated: if the session is past `soft` (already in
 * payment, paid, or already released), the action is a no-op. This guards
 * against the multi-tab race where the holder might click Release while
 * another tab has already moved into payment.
 *
 * On success, the existing `release_soft` RPC moves inventory back from
 * soft_held to available, the session transitions to `released`, and the
 * queue advance logic promotes the next waiter to a 5-min priority_hold.
 */
export async function releaseSoftHoldByHolder(
  input: z.input<typeof Schema>
): Promise<Result<{ released: boolean }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<{ released: boolean }>("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<{ released: boolean }>("Not authenticated", "UNAUTHENTICATED");
  const userId = authData.user.id;

  const admin = createAdminClient();
  const { data: custRow } = await admin
    .from("customers")
    .select("id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  const customerId = (custRow as { id: string } | null)?.id ?? null;
  if (!customerId) return fail<{ released: boolean }>("Missing customer profile", "NO_CUSTOMER");

  // Verify ownership + current state. Only soft sessions are releasable.
  const { data: sessionRow } = await admin
    .from("cart_checkout_sessions")
    .select("id, state, cart_id, customer_id")
    .eq("id", parsed.data.session_id)
    .maybeSingle();
  const session = sessionRow as {
    id: string;
    state: string;
    cart_id: string | null;
    customer_id: string;
  } | null;
  if (!session || session.customer_id !== customerId) {
    return fail<{ released: boolean }>("Session not found", "NOT_FOUND");
  }
  if (session.state !== "soft") {
    // Already past the releasable point (payment/completed/already-released).
    // Return success-with-released=false so the caller's UI updates without
    // showing an error.
    return ok({ released: false });
  }

  // Release every cart_item's soft hold back to available in ONE batch.
  // Phase 1c of the follow-up data-layer plan — replaces a per-item
  // sequential release_soft loop. The inventory briefly sits in
  // `available` between release_soft_batch and the promote call below;
  // server-side gap is sub-millisecond. ISFTL is benign (already
  // released by another path); anything else is logged but we proceed.
  if (session.cart_id) {
    const { data: items } = await admin
      .from("cart_items")
      .select("variant_id, quantity")
      .eq("cart_id", session.cart_id)
      .not("variant_id", "is", null)
      .gt("quantity", 0);
    const releaseLines = (
      (items ?? []) as Array<{ variant_id: string; quantity: number }>
    ).map((it) => ({ variant_id: it.variant_id, qty: it.quantity }));
    if (releaseLines.length > 0) {
      const { error: releaseErr } = await admin.rpc(
        "release_soft_batch" as never,
        { p_lines: releaseLines } as never
      );
      if (releaseErr && releaseErr.code !== "ISFTL") {
        console.error(
          `[releaseSoftHoldByHolder] release_soft_batch failed (${releaseErr.code}): ${releaseErr.message}`
        );
      }
    }
  }

  // Mark the session released. The state filter on .eq("state", "soft")
  // makes the UPDATE idempotent — a parallel release path won't double-trip.
  await admin
    .from("cart_checkout_sessions")
    .update({ state: "released", updated_at: new Date().toISOString() })
    .eq("id", parsed.data.session_id)
    .eq("state", "soft");

  // Promote the next FIFO waiter on each variant this session held. Without
  // this call the queue stays stuck even though inventory is back in the
  // available pool. (The cron-driven reaper would eventually advance, but
  // the holder's explicit release should be near-instant for waiters.)
  try {
    await admin.rpc("advance_soft_wait_queue_for_session" as never, {
      p_session_id: parsed.data.session_id,
    } as never);
  } catch (err) {
    // Promotion failures are non-fatal — the soft hold is already released
    // and the next reaper sweep will pick up missed promotions.
    console.error(
      `[releaseSoftHoldByHolder] advance_soft_wait_queue_for_session failed for ${parsed.data.session_id}:`,
      err
    );
  }

  await logAuditEvent({
    actor_id: userId,
    actor_type: "user",
    action: "checkout.session.released_by_holder",
    resource_type: "cart_checkout_session",
    resource_id: parsed.data.session_id,
    metadata: { source: "offer_turn" },
  });

  revalidatePath("/checkout");
  revalidatePath("/cart");
  return ok({ released: true });
}
