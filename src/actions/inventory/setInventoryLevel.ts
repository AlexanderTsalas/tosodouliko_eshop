"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit-log";
import { dispatchWishlistNotifications } from "@/lib/wishlist/dispatchNotifications";
import { fail, ok, type Result } from "@/types/result";
import type { InventoryItem } from "@/types/inventory-sync";

const Schema = z.object({
  variantId: z.string().uuid(),
  quantityAvailable: z.number().int().nonnegative(),
  lowStockThreshold: z.number().int().nonnegative().optional(),
  /**
   * Direct override of `quantity_reserved`. EXPLICITLY OPT-IN — this
   * field is managed by the order lifecycle (placeOrder reserves,
   * deleteOrder / cancel releases). Hand-overwriting it broke order
   * deletion via INSUFFICIENT_RESERVED in the past; the variant table
   * UI no longer exposes it.
   *
   * Set only by deliberate "Reconcile inventory" admin tooling that
   * has explicitly informed the operator they're bypassing the
   * order-state invariant. Defaults to undefined = "leave reserved
   * alone, the DB's COALESCE keeps the current value".
   */
  reconcileReservedTo: z.number().int().nonnegative().optional(),
});

/**
 * Wraps the `set_inventory_level` Postgres RPC, which performs the permission
 * check (`manage:products`) inside the function. Audit-logs the change.
 *
 * Note: this action will NOT touch `quantity_reserved` unless the caller
 * explicitly passes `reconcileReservedTo`. Most admin UIs (variant table,
 * inventory page) omit it and let the DB preserve whatever the order
 * lifecycle has recorded. Only "Reconcile inventory" tooling sets it.
 */
export async function setInventoryLevel(
  input: z.input<typeof Schema>
): Promise<Result<InventoryItem>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<InventoryItem>("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<InventoryItem>("Not authenticated", "UNAUTHENTICATED");

  // Capture the prior available count so we can detect a positive delta —
  // only top-ups should fire the wishlist dispatcher; downward edits or
  // unchanged values are no-ops on the queue.
  const admin = createAdminClient();
  const { data: priorRow } = await admin
    .from("inventory_items")
    .select("quantity_available")
    .eq("variant_id", parsed.data.variantId)
    .maybeSingle();
  const priorAvailable = Number(
    (priorRow as { quantity_available: number } | null)?.quantity_available ?? 0
  );

  const { data, error } = await supabase.rpc("set_inventory_level", {
    p_variant_id: parsed.data.variantId,
    p_quantity_available: parsed.data.quantityAvailable,
    // Pass null (= preserve via the RPC's COALESCE) unless caller
    // explicitly invoked the reconcile path.
    p_quantity_reserved: parsed.data.reconcileReservedTo ?? null,
    p_low_stock_threshold: parsed.data.lowStockThreshold ?? null,
  });

  if (error) return fail<InventoryItem>(error.message, error.code);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action:
      parsed.data.reconcileReservedTo !== undefined
        ? "inventory.set.reconciled"
        : "inventory.set",
    resource_type: "variant",
    resource_id: parsed.data.variantId,
    metadata: {
      quantity_available: parsed.data.quantityAvailable,
      reconcile_reserved_to: parsed.data.reconcileReservedTo,
      low_stock_threshold: parsed.data.lowStockThreshold,
      prior_available: priorAvailable,
    },
  });

  // Phase 6 follow-up: admin top-up trigger. Fire the dispatcher with the
  // delta so queued wishlist subscribers get notified inline. Skip on
  // no-change / downward edits.
  const delta = parsed.data.quantityAvailable - priorAvailable;
  if (delta > 0) {
    await dispatchWishlistNotifications({
      variant_id: parsed.data.variantId,
      released_qty: delta,
      triggered_by: "admin_topup",
    });
  }

  revalidatePath("/admin/inventory");
  revalidatePath("/admin/products");
  revalidatePath("/products");
  // Storefront facet counts + OOS badges change when inventory moves.
  // The base /products path is busted above, but tag-based busting is
  // what reaches filtered URLs (?category=foo&color=red) which Next.js
  // path revalidation can't target.
  updateTag("catalog-facets");
  return ok(data as unknown as InventoryItem);
}
