"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  supplierId: z.string().uuid(),
  items: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        orderedQty: z.number().int().positive(),
      })
    )
    .min(1)
    .max(200),
});

interface BulkAddResult {
  supply_order_id: string;
  /** Number of NEW lines actually inserted. */
  added: number;
  /** Variants that were already on this draft — no change made. */
  alreadyInDraft: string[];
  failed: Array<{ variantId: string; reason: string }>;
}

/**
 * Batched bulk-add for a single supplier. ALL data is gathered in a constant
 * number of round-trips (regardless of N items) and lines are written in a
 * single concurrent-safe UPSERT:
 *
 *   - 1 query: find-or-create draft (+1 round-trip on concurrent race)
 *   - 1 parallel batch: variant info + inventory + supplier_products SKU +
 *                       latest purchase_lots cost
 *   - 1 UPSERT (ON CONFLICT DO NOTHING) for supply_order_lines
 *
 * Concurrency safety is delegated to the DB:
 *   - Partial unique index `(supplier_id) WHERE status='draft'` -> race on
 *     draft creation surfaces as 23505 and we recover by re-fetching.
 *   - Unique constraint `(supply_order_id, variant_id)` -> duplicate adds are
 *     ignored at row level; the rest of the batch still lands.
 */
export async function addManyToDraft(
  input: z.input<typeof Schema>
): Promise<Result<BulkAddResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<BulkAddResult>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:suppliers"))) {
    return fail<BulkAddResult>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  const supplierId = parsed.data.supplierId;
  const items = parsed.data.items;
  const variantIds = items.map((i) => i.variantId);

  // 1. Find or create the draft. With the partial unique index there is at
  //    most one open draft per supplier, so the SELECT is a deterministic
  //    lookup; the INSERT may still race with a concurrent run, which we
  //    handle by refetching on 23505.
  const { data: existing } = await supabase
    .from("supply_orders")
    .select("id")
    .eq("supplier_id", supplierId)
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
        supplier_id: supplierId,
        status: "draft",
        created_by: authData.user?.id ?? null,
      })
      .select("id")
      .single();
    if (createErr || !created) {
      if (createErr?.code === "23505") {
        // Concurrent run beat us to the draft creation. Refetch.
        const { data: raced } = await supabase
          .from("supply_orders")
          .select("id")
          .eq("supplier_id", supplierId)
          .eq("status", "draft")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!raced) {
          return fail<BulkAddResult>("Could not create draft", createErr.code);
        }
        supplyOrderId = (raced as { id: string }).id;
      } else {
        return fail<BulkAddResult>(
          createErr?.message ?? "Could not create draft",
          createErr?.code
        );
      }
    } else {
      supplyOrderId = (created as { id: string }).id;
    }
  }

  // 2. Batch the lookups in parallel. We no longer pre-fetch existing draft
  //    lines because the UPSERT below is idempotent.
  const [
    { data: variantRows },
    { data: invRows },
    { data: spRows },
    { data: lotRows },
  ] = await Promise.all([
    supabase
      .from("product_variants")
      .select("id, sku, attribute_combo, products(name)")
      .in("id", variantIds),
    supabase
      .from("inventory_items")
      .select("variant_id, quantity_available, low_stock_threshold")
      .in("variant_id", variantIds),
    supabase
      .from("supplier_products")
      .select("variant_id, supplier_sku")
      .in("variant_id", variantIds)
      .eq("supplier_id", supplierId),
    // Latest cost per (variant, supplier) — sort DESC and pick first per
    // variant in JS. Cheaper than DISTINCT ON via PostgREST.
    supabase
      .from("purchase_lots")
      .select("variant_id, unit_cost, unit_cost_currency, received_at")
      .in("variant_id", variantIds)
      .eq("supplier_id", supplierId)
      .order("received_at", { ascending: false }),
  ]);

  // Index lookups by variant_id.
  type VariantRow = {
    id: string;
    sku: string;
    attribute_combo: Record<string, string> | null;
    products: { name: string } | { name: string }[] | null;
  };
  const variantById = new Map<string, VariantRow>();
  for (const v of (variantRows ?? []) as VariantRow[]) variantById.set(v.id, v);

  const invByVariant = new Map<string, { quantity_available: number; low_stock_threshold: number }>();
  for (const r of (invRows ?? []) as Array<{
    variant_id: string;
    quantity_available: number;
    low_stock_threshold: number;
  }>) {
    invByVariant.set(r.variant_id, {
      quantity_available: r.quantity_available,
      low_stock_threshold: r.low_stock_threshold,
    });
  }

  const skuByVariant = new Map<string, string | null>();
  for (const r of (spRows ?? []) as Array<{ variant_id: string; supplier_sku: string | null }>) {
    skuByVariant.set(r.variant_id, r.supplier_sku);
  }

  // First lot per variant is the latest (rows came ordered DESC).
  const latestCostByVariant = new Map<
    string,
    { unit_cost: number; unit_cost_currency: string }
  >();
  for (const r of (lotRows ?? []) as Array<{
    variant_id: string;
    unit_cost: number;
    unit_cost_currency: string;
    received_at: string;
  }>) {
    if (!latestCostByVariant.has(r.variant_id)) {
      latestCostByVariant.set(r.variant_id, {
        unit_cost: Number(r.unit_cost),
        unit_cost_currency: r.unit_cost_currency,
      });
    }
  }

  // Batch-resolve attribute value labels across every requested variant.
  const allValueIds = new Set<string>();
  for (const v of variantById.values()) {
    if (!v.attribute_combo) continue;
    for (const id of Object.values(v.attribute_combo)) allValueIds.add(id);
  }
  const valueLabelById = new Map<string, string>();
  if (allValueIds.size > 0) {
    const { data: vRows } = await supabase
      .from("attribute_values")
      .select("id, value")
      .in("id", Array.from(allValueIds));
    for (const r of (vRows ?? []) as Array<{ id: string; value: string }>) {
      valueLabelById.set(r.id, r.value);
    }
  }

  // 3. Build the list of candidate rows. We push every requested item; the
  //    DB will skip duplicates via ON CONFLICT DO NOTHING.
  const failed: Array<{ variantId: string; reason: string }> = [];
  const candidates: Array<{
    supply_order_id: string;
    variant_id: string;
    business_sku_at_draft: string;
    supplier_sku_at_draft: string | null;
    variant_label: string | null;
    qty_at_draft: number | null;
    threshold_at_draft: number | null;
    ordered_qty: number;
    unit_cost: number | null;
    unit_cost_currency: string | null;
  }> = [];

  for (const { variantId, orderedQty } of items) {
    const variant = variantById.get(variantId);
    if (!variant) {
      failed.push({ variantId, reason: "Variant not found" });
      continue;
    }
    const productObj = Array.isArray(variant.products) ? variant.products[0] : variant.products;
    let comboLabel: string | null = null;
    if (variant.attribute_combo) {
      const labels = Object.values(variant.attribute_combo)
        .map((id) => valueLabelById.get(id))
        .filter((s): s is string => typeof s === "string");
      if (labels.length > 0) comboLabel = labels.join(", ");
    }
    const variantLabel = comboLabel
      ? `${productObj?.name ?? ""} · ${comboLabel}`
      : productObj?.name ?? null;
    const inv = invByVariant.get(variantId);
    const cost = latestCostByVariant.get(variantId);
    candidates.push({
      supply_order_id: supplyOrderId,
      variant_id: variantId,
      business_sku_at_draft: variant.sku,
      supplier_sku_at_draft: skuByVariant.get(variantId) ?? null,
      variant_label: variantLabel,
      qty_at_draft: inv?.quantity_available ?? null,
      threshold_at_draft: inv?.low_stock_threshold ?? null,
      ordered_qty: orderedQty,
      unit_cost: cost?.unit_cost ?? null,
      unit_cost_currency: cost?.unit_cost_currency ?? null,
    });
  }

  // 4. Single UPSERT with ignoreDuplicates. Returns only the rows actually
  //    inserted; anything ignored was already a line on this draft.
  let added = 0;
  const alreadyInDraft: string[] = [];
  if (candidates.length > 0) {
    const { data: insertedRows, error: insertErr } = await supabase
      .from("supply_order_lines")
      .upsert(candidates, {
        onConflict: "supply_order_id,variant_id",
        ignoreDuplicates: true,
      })
      .select("variant_id");

    if (insertErr) {
      for (const row of candidates) {
        failed.push({ variantId: row.variant_id, reason: insertErr.message });
      }
    } else {
      const insertedIds = new Set<string>();
      for (const r of (insertedRows ?? []) as Array<{ variant_id: string }>) {
        insertedIds.add(r.variant_id);
      }
      added = insertedIds.size;
      for (const c of candidates) {
        if (!insertedIds.has(c.variant_id)) alreadyInDraft.push(c.variant_id);
      }
    }
  }

  if (authData.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "supply_order.lines_bulk_added",
      resource_type: "supply_order",
      resource_id: supplyOrderId,
      metadata: {
        added,
        already_in_draft: alreadyInDraft.length,
        failed_count: failed.length,
      },
    });
  }

  revalidatePath("/admin/supply-orders");
  revalidatePath("/admin/inventory");
  return ok({ supply_order_id: supplyOrderId, added, alreadyInDraft, failed });
}
