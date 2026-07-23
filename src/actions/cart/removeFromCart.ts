"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { releaseCustomerPriorityHolds } from "@/lib/inventory/releaseCustomerPriorityHolds";
import { fail, ok, type Result } from "@/types/result";

const RemoveSchema = z.object({
  cartItemId: z.string().uuid(),
});

export async function removeFromCart(
  input: z.infer<typeof RemoveSchema>
): Promise<Result<null>> {
  const parsed = RemoveSchema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<null>("Not authenticated", "UNAUTHENTICATED");

  // Phase 10 §16.2 + ownership tightening: fetch the cart_item with its
  // parent cart's user_id. We use the admin client to bypass RLS (so this
  // works uniformly for anon + permanent customers), then enforce
  // ownership explicitly before any mutation.
  const admin = createAdminClient();
  const { data: itemRow } = await admin
    .from("cart_items")
    .select("variant_id, quantity, cart_id, carts!inner(user_id)")
    .eq("id", parsed.data.cartItemId)
    .maybeSingle();
  type ItemWithCart = {
    variant_id: string | null;
    quantity: number;
    cart_id: string;
    carts: { user_id: string } | { user_id: string }[];
  };
  const row = itemRow as ItemWithCart | null;
  const cartOwnerId = Array.isArray(row?.carts)
    ? row?.carts[0]?.user_id
    : row?.carts?.user_id;
  if (!row || cartOwnerId !== authData.user.id) {
    return fail<null>("Cart item not found", "NOT_FOUND");
  }
  const variantId = row.variant_id ?? null;
  const removedQty = row.quantity;
  const cartId = row.cart_id;

  // Resolve the customer id (needed for both holder and waiter detection).
  const { data: custRow } = await admin
    .from("customers")
    .select("id")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  const customerId = (custRow as { id: string } | null)?.id ?? null;

  // Detect contention roles BEFORE delete so we capture the parent
  // checkout_session_id for waiters (the FK CASCADE wipes the soft_waits
  // row when the cart_item is deleted).
  let holderSessionId: string | null = null;
  let waiterParentSessionId: string | null = null;
  if (variantId && customerId) {
    // Holder: this customer has an active 'soft' session on the same cart,
    // and this cart item contributes to their soft hold.
    const { data: holderRow } = await admin
      .from("cart_checkout_sessions")
      .select("id")
      .eq("customer_id", customerId)
      .eq("cart_id", cartId)
      .eq("state", "soft")
      .maybeSingle();
    holderSessionId = (holderRow as { id: string } | null)?.id ?? null;

    // Waiter: this customer has a pending soft_waits row on this variant.
    if (!holderSessionId) {
      const { data: waitRow } = await admin
        .from("soft_waits")
        .select("checkout_session_id")
        .eq("customer_id", customerId)
        .eq("variant_id", variantId)
        .is("promoted_at", null)
        .maybeSingle();
      waiterParentSessionId =
        (waitRow as { checkout_session_id: string } | null)?.checkout_session_id ?? null;
    }
  }

  const { error } = await supabase
    .from("cart_items")
    .delete()
    .eq("id", parsed.data.cartItemId);

  if (error) return fail<null>(error.message, error.code);

  if (variantId && customerId) {
    await releaseCustomerPriorityHolds({
      customer_id: customerId,
      variant_id: variantId,
    });
  }

  // Holder case: customer removed an item that was part of their own soft
  // hold. Release the soft hold for that variant, then advance the queue
  // so any waiter behind it gets promoted. (Other variants still in the
  // session keep their soft holds untouched; the queue advance is no-op
  // for variants whose inventory hasn't moved.)
  if (variantId && holderSessionId) {
    try {
      await admin.rpc("release_soft" as never, {
        p_variant_id: variantId,
        p_qty: removedQty,
      } as never);
    } catch {
      // INSUFFICIENT_SOFT_HELD — already released, benign.
    }
    try {
      await admin.rpc("advance_soft_wait_queue_for_session" as never, {
        p_session_id: holderSessionId,
      } as never);
    } catch {
      // Promotion failures are non-fatal — cron will pick up missed ones.
    }
    await admin.rpc("apply_contention_timer" as never, {
      p_session_id: holderSessionId,
    } as never);
  }

  // Waiter case: the soft_waits row was CASCADE-deleted with the cart_item.
  // Recompute the parent session's contention timer — if this was the last
  // waiter, expires_at clears (holder uncontended again).
  if (waiterParentSessionId) {
    await admin.rpc("apply_contention_timer" as never, {
      p_session_id: waiterParentSessionId,
    } as never);
  }

  revalidatePath("/cart");
  revalidatePath("/checkout");
  return ok(null);
}
