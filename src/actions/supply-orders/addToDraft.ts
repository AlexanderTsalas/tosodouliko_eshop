"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import { getCurrentSupplierCost } from "@/lib/suppliers/getCurrentSupplierCost";

const Schema = z.object({
  supplierId: z.string().uuid(),
  variantId: z.string().uuid(),
  /** Initial quantity to draft. Required > 0; admin can edit later. */
  orderedQty: z.number().int().positive(),
});

/**
 * Adds a variant to the open draft for (supplier). Creates the draft if
 * none exists. Snapshots SKU/threshold/qty/cost at draft time so the line
 * remains readable later even if the variant changes.
 *
 * Returns the draft's id so the caller can navigate to the workspace tab.
 */
export async function addToDraft(
  input: z.input<typeof Schema>
): Promise<Result<{ supply_order_id: string; line_id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ supply_order_id: string; line_id: string }>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:suppliers"))) {
    return fail<{ supply_order_id: string; line_id: string }>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  // 1. Get or create an open draft for this supplier.
  const { data: existing } = await supabase
    .from("supply_orders")
    .select("id")
    .eq("supplier_id", parsed.data.supplierId)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let supplyOrderId: string;
  if (existing) {
    supplyOrderId = (existing as { id: string }).id;
  } else {
    const { data: created, error: createErr } = await supabase
      .from("supply_orders")
      .insert({
        supplier_id: parsed.data.supplierId,
        status: "draft",
        created_by: authData.user?.id ?? null,
      })
      .select("id")
      .single();
    if (createErr || !created) {
      if (createErr?.code === "23505") {
        // Concurrent run created the draft. Refetch.
        const { data: raced } = await supabase
          .from("supply_orders")
          .select("id")
          .eq("supplier_id", parsed.data.supplierId)
          .eq("status", "draft")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!raced) {
          return fail<{ supply_order_id: string; line_id: string }>(
            "Could not create draft",
            createErr.code
          );
        }
        supplyOrderId = (raced as { id: string }).id;
      } else {
        return fail<{ supply_order_id: string; line_id: string }>(
          createErr?.message ?? "Could not create draft",
          createErr?.code
        );
      }
    } else {
      supplyOrderId = (created as { id: string }).id;
    }
  }

  // 2. Snapshot fields from the variant + its inventory + supplier_products.
  const [{ data: variantRow }, { data: invRow }, { data: spRow }] = await Promise.all([
    supabase
      .from("product_variants")
      .select("sku, attribute_combo, products(name)")
      .eq("id", parsed.data.variantId)
      .maybeSingle(),
    supabase
      .from("inventory_items")
      .select("quantity_available, low_stock_threshold")
      .eq("variant_id", parsed.data.variantId)
      .maybeSingle(),
    supabase
      .from("supplier_products")
      .select("supplier_sku")
      .eq("variant_id", parsed.data.variantId)
      .eq("supplier_id", parsed.data.supplierId)
      .maybeSingle(),
  ]);

  const variant = variantRow as {
    sku: string;
    attribute_combo: Record<string, string> | null;
    products: { name: string } | { name: string }[] | null;
  } | null;
  if (!variant) {
    return fail<{ supply_order_id: string; line_id: string }>("Variant not found", "NOT_FOUND");
  }

  const productObj = Array.isArray(variant.products) ? variant.products[0] : variant.products;
  let comboLabel: string | null = null;
  if (variant.attribute_combo) {
    const ids = Object.values(variant.attribute_combo);
    if (ids.length > 0) {
      const { data: vRows } = await supabase
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
  const supplierSku = (spRow as { supplier_sku: string | null } | null)?.supplier_sku ?? null;
  const inv = invRow as { quantity_available: number; low_stock_threshold: number } | null;

  const currentCost = await getCurrentSupplierCost(parsed.data.variantId, parsed.data.supplierId);

  // 3. Insert the line. If a line for this variant already exists on this
  //    draft, return the existing line id without modification — never
  //    silently increment via add (qty changes happen in the draft view).
  const { data: existingLine } = await supabase
    .from("supply_order_lines")
    .select("id")
    .eq("supply_order_id", supplyOrderId)
    .eq("variant_id", parsed.data.variantId)
    .maybeSingle();

  let lineId: string;
  if (existingLine) {
    const cur = existingLine as { id: string };
    lineId = cur.id;
    // No-op: already on draft.
  } else {
    const { data: insertedLine, error: insertErr } = await supabase
      .from("supply_order_lines")
      .insert({
        supply_order_id: supplyOrderId,
        variant_id: parsed.data.variantId,
        business_sku_at_draft: variant.sku,
        supplier_sku_at_draft: supplierSku,
        variant_label: variantLabel,
        qty_at_draft: inv?.quantity_available ?? null,
        threshold_at_draft: inv?.low_stock_threshold ?? null,
        ordered_qty: parsed.data.orderedQty,
        unit_cost: currentCost?.unit_cost ?? null,
        unit_cost_currency: currentCost?.unit_cost_currency ?? null,
      })
      .select("id")
      .single();
    if (insertErr || !insertedLine) {
      if (insertErr?.code === "23505") {
        // Concurrent run inserted the same (order, variant) pair. Treat as
        // already-on-draft and recover the existing line id.
        const { data: raced } = await supabase
          .from("supply_order_lines")
          .select("id")
          .eq("supply_order_id", supplyOrderId)
          .eq("variant_id", parsed.data.variantId)
          .maybeSingle();
        if (!raced) {
          return fail<{ supply_order_id: string; line_id: string }>(
            "Could not insert line",
            insertErr.code
          );
        }
        lineId = (raced as { id: string }).id;
      } else {
        return fail<{ supply_order_id: string; line_id: string }>(
          insertErr?.message ?? "Could not insert line",
          insertErr?.code
        );
      }
    } else {
      lineId = (insertedLine as { id: string }).id;
    }
  }

  if (authData.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "supply_order.line_added",
      resource_type: "supply_order",
      resource_id: supplyOrderId,
      metadata: { variant_id: parsed.data.variantId, qty: parsed.data.orderedQty },
    });
  }

  revalidatePath("/admin/supply-orders");
  revalidatePath("/admin/inventory");
  return ok({ supply_order_id: supplyOrderId, line_id: lineId });
}
