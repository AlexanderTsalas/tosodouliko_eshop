"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { releaseCustomerPriorityHolds } from "@/lib/inventory/releaseCustomerPriorityHolds";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  wishlist_item_id: z.string().uuid(),
});

/**
 * Phase 5 — explicit deletion of a wishlist item from the account page.
 * Different semantic from toggleWishlist (which flips presence):
 * removeWishlistItem unconditionally drops the entry. Caller must own it.
 */
export async function removeWishlistItem(
  input: z.input<typeof Schema>
): Promise<Result<{ removed: boolean }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ removed: boolean }>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<{ removed: boolean }>("Δεν είστε συνδεδεμένοι.", "UNAUTHENTICATED");
  }
  if (authData.user.is_anonymous) {
    return fail<{ removed: boolean }>(
      "Δημιουργήστε λογαριασμό για να διαχειριστείτε τη λίστα επιθυμιών.",
      "NEEDS_ACCOUNT"
    );
  }
  const userId = authData.user.id;

  // Resolve customer first — wishlist tables are now keyed off customer_id.
  const admin = createAdminClient();
  const { data: custRow } = await admin
    .from("customers")
    .select("id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  const customerId = (custRow as { id: string } | null)?.id ?? null;
  if (!customerId) {
    return fail<{ removed: boolean }>("Missing customer profile", "NO_CUSTOMER");
  }

  // Phase 10 §16.3: capture variant_id before deletion so a still-active
  // priority hold can be released too. The admin client bypasses RLS, so we
  // scope the read explicitly to this customer.
  const { data: wishRow } = await admin
    .from("wishlist_items")
    .select("variant_id")
    .eq("id", parsed.data.wishlist_item_id)
    .eq("customer_id", customerId)
    .maybeSingle();
  const variantId =
    (wishRow as { variant_id: string | null } | null)?.variant_id ?? null;

  const { data, error } = await supabase
    .from("wishlist_items")
    .delete()
    .eq("id", parsed.data.wishlist_item_id)
    .select("id")
    .maybeSingle();
  if (error) return fail<{ removed: boolean }>(error.message, error.code);
  if (!data) {
    return fail<{ removed: boolean }>(
      "Δεν βρέθηκε το είδος ή δεν σας ανήκει.",
      "NOT_FOUND"
    );
  }

  if (variantId) {
    await releaseCustomerPriorityHolds({
      customer_id: customerId,
      variant_id: variantId,
    });
  }

  await logAuditEvent({
    actor_id: userId,
    actor_type: "user",
    action: "wishlist.item_removed",
    resource_type: "wishlist_item",
    resource_id: parsed.data.wishlist_item_id,
  });

  revalidatePath("/wishlist");
  return ok({ removed: true });
}
