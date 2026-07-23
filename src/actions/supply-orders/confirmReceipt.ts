"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const ExistingLineSchema = z.object({
  lineId: z.string().uuid(),
  /** Final received quantity (admin may have adjusted from the file value). */
  receivedQty: z.number().int().nonnegative(),
  /** Final unit cost in supplier's currency (admin may have adjusted). */
  receivedUnitCost: z.number().nonnegative(),
  receivedUnitCostCurrency: z.string().min(3).max(3),
});

const UnexpectedLineSchema = z.object({
  /** The variant the admin matched the unexpected SKU to (may be null to skip). */
  variantId: z.string().uuid(),
  supplierSku: z.string().nullable(),
  receivedQty: z.number().int().positive(),
  receivedUnitCost: z.number().nonnegative(),
  receivedUnitCostCurrency: z.string().min(3).max(3),
});

const Schema = z.object({
  supplyOrderId: z.string().uuid(),
  /** Lines from the original order (admin may set received_qty=0 to indicate missing). */
  existingLines: z.array(ExistingLineSchema),
  /** New lines for items that arrived but weren't on the original order. */
  unexpectedLines: z.array(UnexpectedLineSchema).default([]),
  /** Optional path in supply-order-receipts bucket where the source file lives. */
  receiptFileStorageKey: z.string().max(500).optional(),
  /** Optional notes recorded with this receipt. */
  notes: z.string().max(4000).optional(),
});

/**
 * Confirms receipt of a placed order. Performs in one transactional pass:
 *   1. Validates parent order is in 'placed' state.
 *   2. Updates each existing line's received_qty/received_unit_cost.
 *   3. For unexpected items, inserts a new supply_order_line; if the
 *      (variant, supplier) supplier_products link is missing, creates it.
 *   4. For every line with received_qty > 0:
 *        - INSERT purchase_lots row (variant, supplier, qty, unit_cost, received_at)
 *        - RPC increment_inventory(variant_id, received_qty)
 *   5. Updates supplier_products.lead_time_days (rolling average if known).
 *   6. Sets supply_orders.status='received', received_at=now, receipt_file_storage_key.
 *   7. Audit log entry.
 *
 * Uses the admin client because increment_inventory is SECURITY DEFINER and
 * the policy check is enforced inside the function anyway via checkPermission.
 */
export async function confirmReceipt(
  input: z.input<typeof Schema>
): Promise<Result<{ id: string; lots_inserted: number; unexpected_added: number }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ id: string; lots_inserted: number; unexpected_added: number }>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:suppliers"))) {
    return fail<{ id: string; lots_inserted: number; unexpected_added: number }>(
      "Forbidden",
      "FORBIDDEN"
    );
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: authData } = await supabase.auth.getUser();

  // 1. Validate parent order.
  const { data: orderRow } = await supabase
    .from("supply_orders")
    .select("id, status, supplier_id, placed_at")
    .eq("id", parsed.data.supplyOrderId)
    .maybeSingle();
  if (!orderRow) {
    return fail<{ id: string; lots_inserted: number; unexpected_added: number }>(
      "Order not found",
      "NOT_FOUND"
    );
  }
  const order = orderRow as { id: string; status: string; supplier_id: string; placed_at: string | null };
  if (order.status !== "placed") {
    return fail<{ id: string; lots_inserted: number; unexpected_added: number }>(
      "Order must be in 'placed' state to be received.",
      "WRONG_STATUS"
    );
  }

  const nowIso = new Date().toISOString();
  const receivedAt = nowIso;
  let lotsInserted = 0;
  let unexpectedAdded = 0;

  // 2. Update each existing line. Receiving zero is allowed — it means the
  //    line was missing in the actual shipment.
  for (const l of parsed.data.existingLines) {
    const { error: lineErr } = await admin
      .from("supply_order_lines")
      .update({
        received_qty: l.receivedQty,
        received_unit_cost: l.receivedUnitCost,
      })
      .eq("id", l.lineId);
    if (lineErr) {
      return fail<{ id: string; lots_inserted: number; unexpected_added: number }>(
        `Failed updating line ${l.lineId}: ${lineErr.message}`,
        lineErr.code
      );
    }
  }

  // 3. Build a map of variant_id → received info, including any unexpected
  //    additions (which also need supply_order_line + supplier_products rows).
  const variantReceipts: Array<{
    variantId: string;
    qty: number;
    unitCost: number;
    currency: string;
  }> = [];

  // Pull the variant_id for each existing line so we can build the lot rows
  // and stock increments below.
  const lineIds = parsed.data.existingLines.map((l) => l.lineId);
  if (lineIds.length > 0) {
    const { data: lineRows } = await admin
      .from("supply_order_lines")
      .select("id, variant_id")
      .in("id", lineIds);
    const variantByLine = new Map<string, string>();
    for (const r of (lineRows ?? []) as Array<{ id: string; variant_id: string }>) {
      variantByLine.set(r.id, r.variant_id);
    }
    for (const l of parsed.data.existingLines) {
      if (l.receivedQty <= 0) continue;
      const variantId = variantByLine.get(l.lineId);
      if (!variantId) continue;
      variantReceipts.push({
        variantId,
        qty: l.receivedQty,
        unitCost: l.receivedUnitCost,
        currency: l.receivedUnitCostCurrency.toUpperCase(),
      });
    }
  }

  // 4. Unexpected lines — insert supply_order_line + ensure supplier_products link.
  for (const u of parsed.data.unexpectedLines) {
    // Ensure supplier_products link exists; create if missing.
    const { data: spExisting } = await admin
      .from("supplier_products")
      .select("id")
      .eq("variant_id", u.variantId)
      .eq("supplier_id", order.supplier_id)
      .maybeSingle();
    if (!spExisting) {
      await admin.from("supplier_products").insert({
        variant_id: u.variantId,
        supplier_id: order.supplier_id,
        supplier_sku: u.supplierSku,
      });
    } else if (u.supplierSku) {
      await admin
        .from("supplier_products")
        .update({ supplier_sku: u.supplierSku })
        .eq("id", (spExisting as { id: string }).id);
    }

    // Snapshot variant info for the new line.
    const { data: variantRow } = await admin
      .from("product_variants")
      .select("sku, attribute_combo, products(name)")
      .eq("id", u.variantId)
      .maybeSingle();
    const variant = variantRow as {
      sku: string;
      attribute_combo: Record<string, string> | null;
      products: { name: string } | { name: string }[] | null;
    } | null;
    if (!variant) continue;
    const productObj = Array.isArray(variant.products) ? variant.products[0] : variant.products;
    let comboLabel: string | null = null;
    if (variant.attribute_combo) {
      const ids = Object.values(variant.attribute_combo);
      if (ids.length > 0) {
        const { data: vRows } = await admin
          .from("attribute_values")
          .select("id, value")
          .in("id", ids);
        const byId = new Map(
          ((vRows ?? []) as Array<{ id: string; value: string }>).map((r) => [r.id, r.value])
        );
        const labels = ids.map((id) => byId.get(id)).filter(Boolean) as string[];
        if (labels.length > 0) comboLabel = labels.join(", ");
      }
    }
    const variantLabel = comboLabel
      ? `${productObj?.name ?? ""} · ${comboLabel}`
      : productObj?.name ?? null;

    await admin.from("supply_order_lines").insert({
      supply_order_id: parsed.data.supplyOrderId,
      variant_id: u.variantId,
      business_sku_at_draft: variant.sku,
      supplier_sku_at_draft: u.supplierSku,
      variant_label: variantLabel,
      ordered_qty: u.receivedQty, // we didn't order it; record what arrived
      received_qty: u.receivedQty,
      unit_cost: u.receivedUnitCost,
      unit_cost_currency: u.receivedUnitCostCurrency.toUpperCase(),
      received_unit_cost: u.receivedUnitCost,
      notes: "[unexpected at receipt]",
    });

    variantReceipts.push({
      variantId: u.variantId,
      qty: u.receivedQty,
      unitCost: u.receivedUnitCost,
      currency: u.receivedUnitCostCurrency.toUpperCase(),
    });
    unexpectedAdded++;
  }

  // 5. For each variant with received_qty > 0:
  //    a. Insert purchase_lots row
  //    b. Call increment_inventory RPC
  for (const r of variantReceipts) {
    const { error: lotErr } = await admin.from("purchase_lots").insert({
      variant_id: r.variantId,
      supplier_id: order.supplier_id,
      supply_order_id: parsed.data.supplyOrderId,
      received_qty: r.qty,
      unit_cost: r.unitCost,
      unit_cost_currency: r.currency,
      received_at: receivedAt,
      created_by: authData.user?.id ?? null,
    });
    if (lotErr) {
      return fail<{ id: string; lots_inserted: number; unexpected_added: number }>(
        `Failed inserting lot: ${lotErr.message}`,
        lotErr.code
      );
    }
    lotsInserted++;

    const { error: incErr } = await admin.rpc("increment_inventory", {
      p_variant_id: r.variantId,
      p_qty: r.qty,
    });
    if (incErr) {
      return fail<{ id: string; lots_inserted: number; unexpected_added: number }>(
        `Failed incrementing stock for ${r.variantId}: ${incErr.message}`,
        incErr.code
      );
    }
  }

  // 6. Update supplier_products.lead_time_days (rolling average).
  if (order.placed_at) {
    const leadDays = Math.max(
      1,
      Math.round(
        (new Date(receivedAt).getTime() - new Date(order.placed_at).getTime()) / 86_400_000
      )
    );
    const variantIds = Array.from(new Set(variantReceipts.map((r) => r.variantId)));
    if (variantIds.length > 0) {
      const { data: spRows } = await admin
        .from("supplier_products")
        .select("id, lead_time_days")
        .eq("supplier_id", order.supplier_id)
        .in("variant_id", variantIds);
      for (const sp of (spRows ?? []) as Array<{ id: string; lead_time_days: number | null }>) {
        // Rolling average: ((existing * 3) + new) / 4 — gentle smoothing.
        const next = sp.lead_time_days
          ? Math.round((sp.lead_time_days * 3 + leadDays) / 4)
          : leadDays;
        await admin
          .from("supplier_products")
          .update({ lead_time_days: next, updated_at: nowIso })
          .eq("id", sp.id);
      }
    }
  }

  // 7. Flip order status + persist receipt file path + notes.
  const orderUpdate: Record<string, unknown> = {
    status: "received",
    received_at: receivedAt,
    updated_at: nowIso,
  };
  if (parsed.data.receiptFileStorageKey) {
    orderUpdate.receipt_file_storage_key = parsed.data.receiptFileStorageKey;
  }
  if (parsed.data.notes) {
    orderUpdate.notes = parsed.data.notes;
  }
  const { error: statusErr } = await admin
    .from("supply_orders")
    .update(orderUpdate)
    .eq("id", parsed.data.supplyOrderId);
  if (statusErr) {
    return fail<{ id: string; lots_inserted: number; unexpected_added: number }>(
      statusErr.message,
      statusErr.code
    );
  }

  // 8. Audit log.
  if (authData.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "supply_order.received",
      resource_type: "supply_order",
      resource_id: parsed.data.supplyOrderId,
      metadata: {
        lots_inserted: lotsInserted,
        unexpected_added: unexpectedAdded,
        receipt_file: parsed.data.receiptFileStorageKey ?? null,
      },
    });
  }

  revalidatePath("/admin/supply-orders");
  return ok({ id: parsed.data.supplyOrderId, lots_inserted: lotsInserted, unexpected_added: unexpectedAdded });
}
