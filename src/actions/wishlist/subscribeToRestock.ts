"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  source: z
    .enum(["product_page", "contention_modal", "sold_out_page"])
    .default("contention_modal"),
});

/**
 * Idempotent "notify me when this product is back in stock" subscription.
 *
 * Creates (or updates) a wishlist_items row with `notify_on_restock=true`
 * and the given `source`. Used by:
 *   - the Phase 3 contention modal (source='contention_modal')
 *   - the "Notify me when back in stock" CTA on a sold-out product page (source='sold_out_page')
 *
 * If the customer already has the item in their wishlist, this flips
 * `notify_on_restock=true` without disturbing other flags.
 *
 * Guest customers: returns NOT_AUTHENTICATED. The inline magic-link signup
 * flow that handles guest subscriptions lands in Phase 9 of the impl plan.
 */
export async function subscribeToRestock(
  input: z.infer<typeof Schema>
): Promise<Result<{ added: boolean }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<{ added: boolean }>("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<{ added: boolean }>(
      "Συνδεθείτε για να ενημερωθείτε όταν το προϊόν είναι ξανά διαθέσιμο.",
      "UNAUTHENTICATED"
    );
  }
  // Spec §8.3: wishlist requires a permanent account. Anonymous customers
  // must complete signup (password + email verification) before their
  // interest can be recorded. The client surfaces a "create account" CTA
  // on this error code.
  if (authData.user.is_anonymous) {
    return fail<{ added: boolean }>(
      "Δημιουργήστε λογαριασμό για να λαμβάνετε ειδοποιήσεις αποθέματος.",
      "NEEDS_ACCOUNT"
    );
  }
  const userId = authData.user.id;

  // Wishlist tables are keyed off customer_id since 20260601000006. Resolve
  // the caller's customers row first.
  const { data: custRow } = await supabase
    .from("customers")
    .select("id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  const customerId = (custRow as { id: string } | null)?.id ?? null;
  if (!customerId) {
    return fail<{ added: boolean }>("Missing customer profile", "NO_CUSTOMER");
  }

  // Get-or-create the customer's default wishlist (same pattern as toggleWishlist).
  let { data: wishlistRow } = await supabase
    .from("wishlists")
    .select("id")
    .eq("customer_id", customerId)
    .eq("is_default", true)
    .maybeSingle();
  if (!wishlistRow) {
    const { data: created, error: createErr } = await supabase
      .from("wishlists")
      .insert({ customer_id: customerId, name: "Λίστα επιθυμιών", is_default: true })
      .select("id")
      .single();
    if (createErr || !created) {
      return fail<{ added: boolean }>(
        createErr?.message ?? "Failed to create wishlist",
        "WL_CREATE_FAILED"
      );
    }
    wishlistRow = created;
  }
  const wishlistId = (wishlistRow as { id: string }).id;

  // Check for existing entry with this product+variant combo.
  const variantClause = parsed.data.variantId
    ? supabase
        .from("wishlist_items")
        .select("id, notify_on_restock")
        .eq("customer_id", customerId)
        .eq("product_id", parsed.data.productId)
        .eq("variant_id", parsed.data.variantId)
    : supabase
        .from("wishlist_items")
        .select("id, notify_on_restock")
        .eq("customer_id", customerId)
        .eq("product_id", parsed.data.productId)
        .is("variant_id", null);
  const { data: existing } = await variantClause.maybeSingle();

  if (existing) {
    const existingRow = existing as { id: string; notify_on_restock: boolean };
    // Already subscribed — return success without disturbing other flags.
    if (existingRow.notify_on_restock) return ok({ added: false });
    const { error: updErr } = await supabase
      .from("wishlist_items")
      .update({ notify_on_restock: true, source: parsed.data.source })
      .eq("id", existingRow.id);
    if (updErr) return fail<{ added: boolean }>(updErr.message, updErr.code);
    await logAuditEvent({
      actor_id: userId,
      actor_type: "user",
      action: "wishlist.restock_subscribed",
      resource_type: "wishlist_item",
      resource_id: existingRow.id,
      metadata: { source: parsed.data.source, productId: parsed.data.productId },
    });
    revalidatePath("/wishlist");
    return ok({ added: true });
  }

  // Insert a new wishlist entry with notify_on_restock=true.
  const { data: inserted, error: insErr } = await supabase
    .from("wishlist_items")
    .insert({
      wishlist_id: wishlistId,
      customer_id: customerId,
      product_id: parsed.data.productId,
      variant_id: parsed.data.variantId ?? null,
      quantity: 1,
      notify_on_restock: true,
      source: parsed.data.source,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    return fail<{ added: boolean }>(insErr?.message ?? "Insert failed", insErr?.code);
  }

  await logAuditEvent({
    actor_id: userId,
    actor_type: "user",
    action: "wishlist.restock_subscribed",
    resource_type: "wishlist_item",
    resource_id: (inserted as { id: string }).id,
    metadata: { source: parsed.data.source, productId: parsed.data.productId },
  });

  revalidatePath("/wishlist");
  return ok({ added: true });
}
