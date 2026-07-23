"use server";

import { getCart } from "@/lib/cart";
import type { Result } from "@/types/result";
import type { CartWithItems } from "@/types/shopping-cart";

/**
 * Server-action thin wrapper around getCart so client components can refetch
 * cart state in response to Supabase Realtime events without going through
 * router.refresh (which would re-render the entire current route).
 *
 * Returns the same shape as getCart — null when no auth/active cart.
 */
export async function refreshCart(): Promise<Result<CartWithItems | null>> {
  return getCart();
}
