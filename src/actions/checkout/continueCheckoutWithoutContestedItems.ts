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
 * Holder chose Option B in the contention modal: "Continue without these
 * items." Removes every cart_item whose variant has at least one pending
 * soft_wait behind this session, releases each variant's soft hold, and
 * advances the queue so the FIFO-first waiter on each released variant is
 * promoted to a priority_hold.
 *
 * The session stays in `soft` state with the remaining (uncontested) items.
 * apply_contention_timer is called at the end — since the contested items
 * are gone, the holder's expires_at clears unless other items happen to be
 * contested too.
 */
export async function continueCheckoutWithoutContestedItems(
  input: z.input<typeof Schema>
): Promise<Result<{ removed: number; remaining: number }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ removed: number; remaining: number }>("Invalid input", "INVALID_INPUT");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<{ removed: number; remaining: number }>(
      "Not authenticated",
      "UNAUTHENTICATED"
    );
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
    return fail<{ removed: number; remaining: number }>(
      "Missing customer profile",
      "NO_CUSTOMER"
    );
  }

  const { data: sessionRow } = await admin
    .from("cart_checkout_sessions")
    .select("id, customer_id, cart_id, state")
    .eq("id", parsed.data.session_id)
    .maybeSingle();
  const session = sessionRow as {
    id: string;
    customer_id: string;
    cart_id: string | null;
    state: string;
  } | null;
  if (!session || session.customer_id !== customerId) {
    return fail<{ removed: number; remaining: number }>(
      "Session not found",
      "NOT_FOUND"
    );
  }
  if (session.state !== "soft") {
    // Past the releasable point — nothing to do.
    return ok({ removed: 0, remaining: 0 });
  }

  if (!session.cart_id) return ok({ removed: 0, remaining: 0 });

  // Find the contested variants behind this session.
  const { data: contested } = await admin
    .from("soft_waits")
    .select("variant_id")
    .eq("checkout_session_id", parsed.data.session_id)
    .is("promoted_at", null);
  const contestedVariantIds = Array.from(
    new Set(
      ((contested ?? []) as Array<{ variant_id: string }>).map((r) => r.variant_id)
    )
  );
  if (contestedVariantIds.length === 0) {
    return ok({ removed: 0, remaining: 0 });
  }

  // Fetch the holder's cart_items for those variants.
  const { data: items } = await admin
    .from("cart_items")
    .select("id, variant_id, quantity")
    .eq("cart_id", session.cart_id)
    .in("variant_id", contestedVariantIds);
  const itemsTyped = (items ?? []) as Array<{
    id: string;
    variant_id: string;
    quantity: number;
  }>;

  // Phase 1b of the follow-up data-layer plan: one batch release + one
  // bulk delete instead of 2N sequential round-trips. ISFTL is benign
  // (already released by another path) — log anything else and proceed
  // to the delete regardless (the FK CASCADE on cart_items + the
  // queue-advance below still need to fire even if release failed).
  const releaseLines = itemsTyped.map((it) => ({
    variant_id: it.variant_id,
    qty: it.quantity,
  }));
  if (releaseLines.length > 0) {
    const { error: releaseErr } = await admin.rpc(
      "release_soft_batch" as never,
      { p_lines: releaseLines } as never
    );
    if (releaseErr && releaseErr.code !== "ISFTL") {
      console.error(
        `[continueCheckoutWithoutContestedItems] release_soft_batch failed (${releaseErr.code}): ${releaseErr.message}`
      );
    }
  }
  const itemIds = itemsTyped.map((it) => it.id);
  let removed = 0;
  if (itemIds.length > 0) {
    const { error: delErr } = await admin
      .from("cart_items")
      .delete()
      .in("id", itemIds);
    if (delErr) {
      console.error(
        `[continueCheckoutWithoutContestedItems] bulk delete failed: ${delErr.message}`
      );
    } else {
      removed = itemIds.length;
    }
  }

  // Promote the FIFO-first waiter on each released variant. The function
  // iterates pending waiters per variant on this session and tries each.
  try {
    await admin.rpc("advance_soft_wait_queue_for_session" as never, {
      p_session_id: parsed.data.session_id,
    } as never);
  } catch (err) {
    console.error(
      `[continueCheckoutWithoutContestedItems] advance failed for ${parsed.data.session_id}:`,
      err
    );
  }

  // Recompute the holder's contention timer. With contested items removed,
  // the queue under this session for those variants is gone; if no other
  // variants are contested, expires_at clears.
  await admin.rpc("apply_contention_timer" as never, {
    p_session_id: parsed.data.session_id,
  } as never);

  await logAuditEvent({
    actor_id: userId,
    actor_type: "user",
    action: "checkout.session.dropped_contested_items",
    resource_type: "cart_checkout_session",
    resource_id: parsed.data.session_id,
    metadata: { removed },
  });

  const { count: remainingCount } = await admin
    .from("cart_items")
    .select("id", { count: "exact", head: true })
    .eq("cart_id", session.cart_id);

  revalidatePath("/checkout");
  revalidatePath("/cart");
  return ok({ removed, remaining: remainingCount ?? 0 });
}
