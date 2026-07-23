"use server";

import { getEffectiveAvailableForVariants } from "@/lib/inventory/getEffectiveAvailable";

/**
 * Server-action wrapper around getEffectiveAvailableForVariants so client
 * components can refetch effective availability in response to Supabase
 * Realtime change events on inventory_items.
 *
 * Returns a plain Record (Map doesn't serialize across the action boundary).
 */
export async function getEffectiveAvailableAction(
  variantIds: string[]
): Promise<Record<string, number>> {
  const map = await getEffectiveAvailableForVariants(variantIds);
  return Object.fromEntries(map);
}
