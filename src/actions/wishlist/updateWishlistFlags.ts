"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z
  .object({
    wishlist_item_id: z.string().uuid(),
    notify_on_restock: z.boolean().optional(),
    notify_on_sale: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.notify_on_restock !== undefined || v.notify_on_sale !== undefined,
    { message: "At least one flag must be supplied" }
  );

/**
 * Phase 5 — per-item notification flag updates from the wishlist UI.
 *
 * Driven by:
 *   - WishlistButton Pattern A: chevron-expand panel checkboxes.
 *   - /wishlist account page: per-item toggles.
 *
 * Only updates flags that are explicitly supplied (preserves the others).
 * Caller must own the wishlist_item.
 */
export async function updateWishlistFlags(
  input: z.input<typeof Schema>
): Promise<Result<{ updated: boolean }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ updated: boolean }>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<{ updated: boolean }>(
      "Συνδεθείτε για να ενημερώσετε τη λίστα επιθυμιών.",
      "UNAUTHENTICATED"
    );
  }
  if (authData.user.is_anonymous) {
    return fail<{ updated: boolean }>(
      "Δημιουργήστε λογαριασμό για να διαχειριστείτε τη λίστα επιθυμιών.",
      "NEEDS_ACCOUNT"
    );
  }
  const userId = authData.user.id;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.notify_on_restock !== undefined) {
    patch.notify_on_restock = parsed.data.notify_on_restock;
  }
  if (parsed.data.notify_on_sale !== undefined) {
    patch.notify_on_sale = parsed.data.notify_on_sale;
  }

  // RLS scopes UPDATE to the caller's customer rows (via customers.auth_user_id
  // = auth.uid()), so the .eq filter on id is enough — no separate ownership
  // check needed.
  const { data, error } = await supabase
    .from("wishlist_items")
    .update(patch)
    .eq("id", parsed.data.wishlist_item_id)
    .select("id")
    .maybeSingle();
  if (error) {
    return fail<{ updated: boolean }>(error.message, error.code);
  }
  if (!data) {
    return fail<{ updated: boolean }>(
      "Δεν βρέθηκε το είδος ή δεν σας ανήκει.",
      "NOT_FOUND"
    );
  }

  await logAuditEvent({
    actor_id: userId,
    actor_type: "user",
    action: "wishlist.flags_updated",
    resource_type: "wishlist_item",
    resource_id: parsed.data.wishlist_item_id,
    metadata: patch,
  });

  revalidatePath("/wishlist");
  return ok({ updated: true });
}
