"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().uuid(),
  quantity: z.number().int().positive(),
});

export interface JoinSoftWaitQueueResult {
  /** id of the soft_waits row (for diagnostics / leave action). */
  soft_wait_id: string;
  /** id of the cart_checkout_sessions row we queued behind. */
  queued_behind_session_id: string;
  /**
   * Wall-clock for the session being waited on; informational only. NULL
   * when the holder isn't contended yet (this caller is the first waiter).
   */
  parent_session_expires_at: string | null;
}

/**
 * Phase 4A: "Add to cart and wait" — the third contention-modal option.
 *
 * Inserts the item into the customer's cart at the requested quantity and
 * registers a soft_waits row tied to the soft session currently holding
 * the variant (FIFO position by created_at). When that session releases,
 * the queue advances and the first-in waiter is promoted to a 5-minute
 * priority_hold (see `advance_soft_wait_queue_for_session`).
 *
 * Single-FK semantics: when multiple sessions hold the variant, we queue
 * behind the earliest-expiring one (most likely to release first). This
 * misses promotions from other sessions releasing first, but is acceptable
 * for early-stage scale — see Phase 4 doc for the multi-session
 * fan-out option to revisit later.
 *
 * Inventory effects: NONE. The waiter holds no inventory until promotion.
 * `cart_items` records the intent but doesn't consume from any bucket.
 */
export async function joinSoftWaitQueue(
  input: z.input<typeof Schema>
): Promise<Result<JoinSoftWaitQueueResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<JoinSoftWaitQueueResult>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<JoinSoftWaitQueueResult>(
      "Συνδεθείτε για να μπείτε στη λίστα αναμονής.",
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
    return fail<JoinSoftWaitQueueResult>("Λείπει το προφίλ πελάτη.", "NO_CUSTOMER");
  }

  // Find the soft session currently holding this variant. Uncontended
  // sessions have expires_at = NULL (no deadline yet); contended ones have a
  // future timestamp. Either is a valid holder to queue behind. Among
  // contended holders we still prefer the earliest-expiring (soonest chance
  // at promotion); uncontended holders sort last because we don't know when
  // they'll finish.
  const nowIso = new Date().toISOString();
  const { data: holderRows } = await admin
    .from("cart_checkout_sessions")
    .select("id, customer_id, expires_at, cart_id")
    .eq("state", "soft")
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .neq("customer_id", customerId)
    .order("expires_at", { ascending: true, nullsFirst: false });
  const sessions = (holderRows ?? []) as Array<{
    id: string;
    customer_id: string;
    expires_at: string | null;
    cart_id: string | null;
  }>;

  // Phase 1a of the follow-up data-layer plan: single cart_items query
  // across all candidate sessions, then pick the earliest-expiring holder
  // in JS. Replaces an N+1 per-session SELECT loop on a hot contention
  // path (every time a customer hits "Wait in line" on a contested
  // product).
  const candidateCartIds = sessions
    .map((s) => s.cart_id)
    .filter((id): id is string => id !== null);
  let parentSession: { id: string; expires_at: string | null } | null = null;
  if (candidateCartIds.length > 0) {
    const { data: holderRows } = await admin
      .from("cart_items")
      .select("cart_id")
      .in("cart_id", candidateCartIds)
      .eq("variant_id", parsed.data.variant_id)
      .gt("quantity", 0);
    const holderCartIds = new Set(
      ((holderRows ?? []) as Array<{ cart_id: string }>).map((r) => r.cart_id)
    );
    const holder = sessions
      .filter((s) => s.cart_id !== null && holderCartIds.has(s.cart_id))
      .sort((a, b) => {
        const ax = a.expires_at ? Date.parse(a.expires_at) : Infinity;
        const bx = b.expires_at ? Date.parse(b.expires_at) : Infinity;
        return ax - bx;
      })[0];
    if (holder) parentSession = { id: holder.id, expires_at: holder.expires_at };
  }
  if (!parentSession) {
    // No active soft session holds this variant — the contention may have
    // already cleared. Tell caller to retry (the modal would re-evaluate).
    return fail<JoinSoftWaitQueueResult>(
      "Η διεκδίκηση του προϊόντος δεν είναι πλέον ενεργή. Δοκιμάστε ξανά.",
      "NO_HOLDER",
    );
  }

  // Ensure caller has an active cart; create if missing (mirrors the
  // pattern in addToCart actions).
  const { data: cartRow } = await admin
    .from("carts")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  let cartId = (cartRow as { id: string } | null)?.id ?? null;
  if (!cartId) {
    const { data: newCart, error: cartErr } = await admin
      .from("carts")
      .insert({ user_id: userId, status: "active" })
      .select("id")
      .single();
    if (cartErr || !newCart) {
      return fail<JoinSoftWaitQueueResult>(
        cartErr?.message ?? "Cart creation failed",
        cartErr?.code ?? "CART_INSERT_FAILED"
      );
    }
    cartId = (newCart as { id: string }).id;
  }

  // Upsert the cart_item. If the customer already has the variant in cart
  // we don't overwrite quantity (they may have manually changed it after
  // initial contention) — we just reuse the row.
  const { data: existingItem } = await admin
    .from("cart_items")
    .select("id, quantity")
    .eq("cart_id", cartId)
    .eq("variant_id", parsed.data.variant_id)
    .maybeSingle();
  let cartItemId: string;
  if (existingItem) {
    cartItemId = (existingItem as { id: string }).id;
  } else {
    // Fetch the canonical unit_price for the variant so the cart_item snapshot
    // is consistent with what add-to-cart would do.
    const { data: variantRow } = await admin
      .from("product_variants")
      .select("price")
      .eq("id", parsed.data.variant_id)
      .maybeSingle();
    const unitPrice = Number((variantRow as { price: number | string } | null)?.price ?? 0);
    const { data: newItem, error: itemErr } = await admin
      .from("cart_items")
      .insert({
        cart_id: cartId,
        product_id: parsed.data.product_id,
        variant_id: parsed.data.variant_id,
        quantity: parsed.data.quantity,
        unit_price: unitPrice,
      })
      .select("id")
      .single();
    if (itemErr || !newItem) {
      return fail<JoinSoftWaitQueueResult>(
        itemErr?.message ?? "Cart insert failed",
        itemErr?.code ?? "CART_ITEM_INSERT_FAILED"
      );
    }
    cartItemId = (newItem as { id: string }).id;
  }

  // Insert the soft_waits row. Unique constraint on
  // (checkout_session_id, customer_id, variant_id) makes this idempotent —
  // a duplicate join just re-uses the existing row.
  const { data: existingWait } = await admin
    .from("soft_waits")
    .select("id")
    .eq("checkout_session_id", parentSession.id)
    .eq("customer_id", customerId)
    .eq("variant_id", parsed.data.variant_id)
    .maybeSingle();
  let waitId: string;
  if (existingWait) {
    waitId = (existingWait as { id: string }).id;
  } else {
    const { data: newWait, error: waitErr } = await admin
      .from("soft_waits")
      .insert({
        checkout_session_id: parentSession.id,
        customer_id: customerId,
        cart_item_id: cartItemId,
        variant_id: parsed.data.variant_id,
        quantity: parsed.data.quantity,
      })
      .select("id")
      .single();
    if (waitErr || !newWait) {
      return fail<JoinSoftWaitQueueResult>(
        waitErr?.message ?? "Queue insert failed",
        waitErr?.code ?? "SOFT_WAIT_INSERT_FAILED"
      );
    }
    waitId = (newWait as { id: string }).id;
  }

  // Refresh the holder's contention timer. Queue went 0 → ≥1 starts the
  // 15-minute clock on the holder. No-op if already set.
  await admin.rpc("apply_contention_timer" as never, {
    p_session_id: parentSession.id,
  } as never);

  await logAuditEvent({
    actor_id: userId,
    actor_type: "user",
    action: "cart.soft_wait_joined",
    resource_type: "soft_wait",
    resource_id: waitId,
    metadata: {
      variant_id: parsed.data.variant_id,
      quantity: parsed.data.quantity,
      queued_behind_session_id: parentSession.id,
    },
  });

  revalidatePath("/cart");
  return ok({
    soft_wait_id: waitId,
    queued_behind_session_id: parentSession.id,
    parent_session_expires_at: parentSession.expires_at,
  });
}
