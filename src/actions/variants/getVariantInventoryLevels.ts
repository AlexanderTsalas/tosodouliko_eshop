"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/rbac";

/**
 * Current quantity_available per variant, read fresh. Used by variant
 * bulk-propagation: setInventoryLevel always SETS available (the RPC does
 * not COALESCE it), so when propagating a threshold/reserved change we
 * must pass each target's CURRENT available — not a possibly-stale panel
 * snapshot — to avoid clobbering a sibling's just-edited stock.
 */
export async function getVariantInventoryLevels(
  variantIds: string[]
): Promise<Record<string, number>> {
  await requirePermission("manage:products");
  if (variantIds.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("inventory_items")
    .select("variant_id, quantity_available")
    .in("variant_id", variantIds);
  const map: Record<string, number> = {};
  for (const r of (data ?? []) as Array<{
    variant_id: string;
    quantity_available: number;
  }>) {
    map[r.variant_id] = r.quantity_available;
  }
  return map;
}
