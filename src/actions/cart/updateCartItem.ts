"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type Result } from "@/types/result";

const UpdateSchema = z.object({
  cartItemId: z.string().uuid(),
  quantity: z.number().int().positive(),
});

export async function updateCartItem(
  input: z.infer<typeof UpdateSchema>
): Promise<Result<null>> {
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<null>("Not authenticated", "UNAUTHENTICATED");
  const userId = authData.user.id;

  // Explicit ownership check on top of RLS — defense in depth so that if
  // an RLS policy on cart_items is ever loosened by mistake, the action
  // still refuses to mutate items belonging to another cart.
  const admin = createAdminClient();
  const { data: itemRow } = await admin
    .from("cart_items")
    .select("id, carts!inner(user_id)")
    .eq("id", parsed.data.cartItemId)
    .maybeSingle();
  const ownerId = (
    itemRow as { id: string; carts: { user_id: string } | { user_id: string }[] } | null
  )?.carts;
  const cartOwnerId = Array.isArray(ownerId) ? ownerId[0]?.user_id : ownerId?.user_id;
  if (!cartOwnerId || cartOwnerId !== userId) {
    return fail<null>("Cart item not found", "NOT_FOUND");
  }

  const { error } = await supabase
    .from("cart_items")
    .update({ quantity: parsed.data.quantity })
    .eq("id", parsed.data.cartItemId);

  if (error) return fail<null>(error.message, error.code);
  revalidatePath("/cart");
  return ok(null);
}
