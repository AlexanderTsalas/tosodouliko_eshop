"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/types/result";

const ToggleSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
});

export async function toggleWishlist(
  input: z.infer<typeof ToggleSchema>
): Promise<Result<{ added: boolean; wishlist_item_id: string | null }>> {
  type R = { added: boolean; wishlist_item_id: string | null };
  const parsed = ToggleSchema.safeParse(input);
  if (!parsed.success) return fail<R>("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<R>("Not authenticated", "UNAUTHENTICATED");
  // Spec §8.3: wishlist requires a permanent account.
  if (authData.user.is_anonymous) {
    return fail<R>(
      "Δημιουργήστε λογαριασμό για να αποθηκεύσετε στη λίστα επιθυμιών.",
      "NEEDS_ACCOUNT"
    );
  }

  // Resolve the caller's customer row. Wishlist tables are keyed off
  // customer_id since 20260601000006; auth.users.id is just the login binding.
  const { data: custRow } = await supabase
    .from("customers")
    .select("id")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  const customerId = (custRow as { id: string } | null)?.id ?? null;
  if (!customerId) {
    return fail<R>("Missing customer profile", "NO_CUSTOMER");
  }

  // Get-or-create default wishlist. The customers INSERT trigger normally
  // pre-creates one, but we handle the missing case defensively.
  let { data: wishlist } = await supabase
    .from("wishlists")
    .select("id")
    .eq("customer_id", customerId)
    .eq("is_default", true)
    .maybeSingle();

  if (!wishlist) {
    const { data: created, error: createErr } = await supabase
      .from("wishlists")
      .insert({ customer_id: customerId, name: "Λίστα επιθυμιών", is_default: true })
      .select("id")
      .single();
    if (createErr || !created) {
      return fail<R>("Failed to create wishlist", "WL_CREATE_FAILED");
    }
    wishlist = created;
  }

  const wishlistId = (wishlist as { id: string }).id;

  // Existing-entry check. RLS scopes to this customer's rows so .eq is for
  // narrowing inside their own list, not an ownership guard.
  const { data: existing } = await supabase
    .from("wishlist_items")
    .select("id")
    .eq("customer_id", customerId)
    .eq("product_id", parsed.data.productId)
    .eq("variant_id", parsed.data.variantId ?? null)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("wishlist_items")
      .delete()
      .eq("id", (existing as { id: string }).id);
    if (error) return fail<R>(error.message, error.code);
    revalidatePath("/wishlist");
    return ok({ added: false, wishlist_item_id: null });
  }

  const { data: inserted, error } = await supabase
    .from("wishlist_items")
    .insert({
      wishlist_id: wishlistId,
      customer_id: customerId,
      product_id: parsed.data.productId,
      variant_id: parsed.data.variantId ?? null,
    })
    .select("id")
    .single();
  if (error || !inserted) return fail<R>(error?.message ?? "Insert failed", error?.code);
  revalidatePath("/wishlist");
  return ok({ added: true, wishlist_item_id: (inserted as { id: string }).id });
}
