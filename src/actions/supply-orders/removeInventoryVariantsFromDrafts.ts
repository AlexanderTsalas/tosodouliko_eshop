"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  variantIds: z.array(z.string().uuid()).min(1).max(200),
});

export interface RemovedDraftLine {
  variantId: string;
  supplierId: string;
  orderedQty: number;
  /** Empty drafts get auto-deleted; tells the caller so undo recreates them. */
  draftWasDeleted: boolean;
}

interface RemoveResult {
  removed: number;
  removedLines: RemovedDraftLine[];
  notFound: string[];
}

/**
 * Removes lines for the given variant IDs from any open ('draft') supply
 * order. Captures the previous (supplier, qty) so the caller can undo by
 * re-adding through addManyToDraft.
 *
 * If a draft becomes empty after removal, the draft itself is deleted
 * (matches the existing removeDraftLine behaviour).
 */
export async function removeInventoryVariantsFromDrafts(
  input: z.input<typeof Schema>
): Promise<Result<RemoveResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<RemoveResult>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:suppliers"))) {
    return fail<RemoveResult>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  // Find lines on open drafts for these variants.
  const { data: rows } = await supabase
    .from("supply_order_lines")
    .select("id, variant_id, supply_order_id, ordered_qty, supply_orders!inner(supplier_id, status)")
    .in("variant_id", parsed.data.variantIds);

  type Row = {
    id: string;
    variant_id: string;
    supply_order_id: string;
    ordered_qty: number;
    supply_orders:
      | { supplier_id: string; status: string }
      | { supplier_id: string; status: string }[]
      | null;
  };

  const candidates = ((rows ?? []) as Row[])
    .map((r) => {
      const so = Array.isArray(r.supply_orders) ? r.supply_orders[0] : r.supply_orders;
      return so ? { row: r, supplier_id: so.supplier_id, status: so.status } : null;
    })
    .filter(
      (x): x is { row: Row; supplier_id: string; status: string } =>
        x !== null && x.status === "draft"
    );

  const removedLines: RemovedDraftLine[] = [];
  const touchedOrderIds = new Set<string>();
  const failedDeletes: string[] = [];

  for (const c of candidates) {
    const { error } = await supabase.from("supply_order_lines").delete().eq("id", c.row.id);
    if (error) {
      failedDeletes.push(c.row.variant_id);
      continue;
    }
    touchedOrderIds.add(c.row.supply_order_id);
    removedLines.push({
      variantId: c.row.variant_id,
      supplierId: c.supplier_id,
      orderedQty: c.row.ordered_qty,
      draftWasDeleted: false, // will flip below if its draft becomes empty
    });
  }

  // Sweep empty drafts.
  for (const orderId of touchedOrderIds) {
    const { count } = await supabase
      .from("supply_order_lines")
      .select("id", { count: "exact", head: true })
      .eq("supply_order_id", orderId);
    if ((count ?? 0) === 0) {
      await supabase.from("supply_orders").delete().eq("id", orderId);
      for (const r of removedLines) {
        if (touchedOrderIds.has(orderId) && r.draftWasDeleted === false) {
          // Mark any removed line that belonged to this order — but we don't
          // track order_id on RemovedDraftLine. Approximation: mark all from
          // this supplier as draft-was-deleted, since one supplier = one draft.
          const supplierIdOfDeletedOrder = candidates.find(
            (c) => c.row.supply_order_id === orderId
          )?.supplier_id;
          if (supplierIdOfDeletedOrder && r.supplierId === supplierIdOfDeletedOrder) {
            r.draftWasDeleted = true;
          }
        }
      }
    }
  }

  // Variants requested but not found on any draft.
  const removedSet = new Set(removedLines.map((r) => r.variantId));
  const notFound = parsed.data.variantIds.filter(
    (id) => !removedSet.has(id) && !failedDeletes.includes(id)
  );

  if (authData.user && removedLines.length > 0) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "supply_order.lines_removed_from_inventory",
      resource_type: "supply_order",
      metadata: {
        removed: removedLines.length,
        not_found_count: notFound.length,
        suppliers_touched: Array.from(new Set(removedLines.map((r) => r.supplierId))),
      },
    });
  }

  revalidatePath("/admin/supply-orders");
  revalidatePath("/admin/inventory");
  return ok({ removed: removedLines.length, removedLines, notFound });
}
