import { createClient } from "@/lib/supabase/server";

/**
 * Returns the total number of items in the current user's active cart, or 0
 * if no cart / not authenticated.
 */
export async function getCartItemCount(): Promise<number> {
  const supabase = await createClient();

  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return 0;

  const { data, error } = await supabase
    .from("carts")
    .select("item_count")
    .eq("user_id", authData.user.id)
    .eq("status", "active")
    .maybeSingle();

  if (error || !data) return 0;
  return Number((data as any).item_count ?? 0);
}
