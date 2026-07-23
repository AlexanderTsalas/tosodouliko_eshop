"use server";

import { getContestableAvailableForVariants } from "@/lib/inventory/getContestableAvailable";

/**
 * Server-action wrapper around getContestableAvailableForVariants. Used by
 * the product page's Realtime refetch hook so live changes to
 * quantity_available / soft_held / priority_held keep the CTA in sync.
 */
export async function getContestableAvailableAction(
  variantIds: string[]
): Promise<Record<string, number>> {
  const map = await getContestableAvailableForVariants(variantIds);
  return Object.fromEntries(map);
}
