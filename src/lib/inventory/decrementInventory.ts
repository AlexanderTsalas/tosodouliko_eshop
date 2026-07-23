import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type Result } from "@/types/result";
import type { InventoryItem } from "@/types/inventory-sync";

/**
 * Atomically decrement inventory for a variant. Wraps the
 * `decrement_inventory(uuid, integer)` Postgres RPC which uses a
 * single-statement UPDATE with a `quantity_available >= p_qty` predicate
 * to avoid races and overselling.
 *
 * Contract: must use the atomic RPC — never raw UPDATE from application code.
 */
export async function decrementInventory(
  variantId: string,
  qty: number
): Promise<Result<InventoryItem>> {
  if (qty <= 0) return fail<InventoryItem>("qty must be > 0", "INVALID_QTY");

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("decrement_inventory" as never, {
    p_variant_id: variantId,
    p_qty: qty,
  } as never);

  if (error) {
    if (error.message?.includes("INSUFFICIENT_INVENTORY")) {
      return fail<InventoryItem>("Out of stock", "OUT_OF_STOCK");
    }
    return fail<InventoryItem>(error.message, error.code);
  }

  return ok(data as unknown as InventoryItem);
}
