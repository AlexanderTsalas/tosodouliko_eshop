"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

// 200 keeps the .in(...) URL well under PostgREST's typical 8–16 KB cap even
// when a 5x parallel lookup happens against tables keyed by variant_id.
const Schema = z.object({
  variantIds: z.array(z.string().uuid()).min(1).max(200),
  /** Quantity to draft per variant. If absent, uses max(threshold*2 - current, 10). */
  quantity: z.number().int().positive().optional(),
});

interface ResultRow {
  variantId: string;
  supplierId: string | null;
  outcome: "added" | "already_in_draft" | "no_supplier" | "error";
  reason?: string;
}

/**
 * Pushes one or more variants into the supply-order drafts of their PREFERRED
 * suppliers, in a single fully-batched, concurrency-safe operation.
 *
 * Concurrency is delegated to the DB:
 *   - One partial unique index `(supplier_id) WHERE status='draft'` ensures at
 *     most one open draft per supplier (race recovered via refetch).
 *   - One unique constraint `(supply_order_id, variant_id)` ensures we never
 *     get duplicate lines; the bulk INSERT is an upsert with ignoreDuplicates
 *     so concurrent adds of the same variant collapse atomically rather than
 *     failing the whole batch.
 *
 * Round-trip budget (constant in N items):
 *   - 1 parallel: supplier_products + inventory_items + product_variants(+products)
 *   - 1 parallel: existing open drafts + latest purchase_lots
 *   - 1 (conditional): INSERT missing drafts  (+1 on race)
 *   - 1 (conditional): UPSERT supply_order_lines
 *   - 1: audit log
 */
export async function addInventoryVariantsToDrafts(
  input: z.input<typeof Schema>
): Promise<Result<{ added: number; results: ResultRow[] }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ added: number; results: ResultRow[] }>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:suppliers"))) {
    return fail<{ added: number; results: ResultRow[] }>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id ?? null;

  const variantIds = parsed.data.variantIds;
  const overrideQty = parsed.data.quantity;

  // Phase 1 — fetch everything keyed only by variantIds in parallel.
  const [
    { data: spRows },
    { data: invRows },
    { data: variantRows },
  ] = await Promise.all([
    supabase
      .from("supplier_products")
      .select("variant_id, supplier_id, supplier_sku, is_preferred")
      .in("variant_id", variantIds)
      .eq("active", true),
    supabase
      .from("inventory_items")
      .select("variant_id, quantity_available, low_stock_threshold")
      .in("variant_id", variantIds),
    supabase
      .from("product_variants")
      .select("id, sku, attribute_combo, products(name)")
      .in("id", variantIds),
  ]);

  type SpRow = {
    variant_id: string;
    supplier_id: string;
    supplier_sku: string | null;
    is_preferred: boolean;
  };
  const linksByVariant = new Map<string, SpRow[]>();
  for (const r of (spRows ?? []) as SpRow[]) {
    const list = linksByVariant.get(r.variant_id) ?? [];
    list.push(r);
    linksByVariant.set(r.variant_id, list);
  }

  const invByVariant = new Map<
    string,
    { quantity_available: number; low_stock_threshold: number }
  >();
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

  type VariantRow = {
    id: string;
    sku: string;
    attribute_combo: Record<string, string> | null;
    products: { name: string } | { name: string }[] | null;
  };
  const variantById = new Map<string, VariantRow>();
  for (const v of (variantRows ?? []) as VariantRow[]) variantById.set(v.id, v);

  // Resolve preferred supplier + qty per variant.
  type Assigned = {
    variantId: string;
    supplierId: string;
    supplierSku: string | null;
    orderedQty: number;
  };
  let assigned: Assigned[] = [];
  const results: ResultRow[] = [];

  for (const variantId of variantIds) {
    const links = linksByVariant.get(variantId) ?? [];
    if (links.length === 0) {
      results.push({ variantId, supplierId: null, outcome: "no_supplier" });
      continue;
    }
    const preferred = links.find((l) => l.is_preferred) ?? links[0];
    const inv = invByVariant.get(variantId);
    const qty =
      overrideQty ??
      Math.max(
        (inv?.low_stock_threshold ?? 0) * 2 - (inv?.quantity_available ?? 0),
        10
      );
    assigned.push({
      variantId,
      supplierId: preferred.supplier_id,
      supplierSku: preferred.supplier_sku,
      orderedQty: qty,
    });
  }

  if (assigned.length === 0) {
    return ok({ added: 0, results });
  }

  const supplierIds = Array.from(new Set(assigned.map((a) => a.supplierId)));

  // Phase 2 — needs supplierIds. Existing drafts + latest cost in parallel.
  const [
    { data: existingDraftRows },
    { data: lotRows },
  ] = await Promise.all([
    supabase
      .from("supply_orders")
      .select("id, supplier_id, created_at")
      .in("supplier_id", supplierIds)
      .eq("status", "draft")
      .order("created_at", { ascending: false }),
    supabase
      .from("purchase_lots")
      .select("variant_id, supplier_id, unit_cost, unit_cost_currency, received_at")
      .in("variant_id", variantIds)
      .in("supplier_id", supplierIds)
      .order("received_at", { ascending: false }),
  ]);

  // Most recent draft per supplier (rows came ordered DESC). With the partial
  // unique index there should only be one row per supplier, but DESC + first-
  // wins keeps us robust during the rollout before the index is in place.
  const draftBySupplier = new Map<string, string>();
  for (const r of (existingDraftRows ?? []) as Array<{ id: string; supplier_id: string }>) {
    if (!draftBySupplier.has(r.supplier_id)) {
      draftBySupplier.set(r.supplier_id, r.id);
    }
  }

  // Phase 3 — create missing drafts. With the partial unique index, a
  // concurrent run that already inserted the draft will surface as 23505;
  // recover by re-fetching and continuing without that supplier failing.
  const missingSuppliers = supplierIds.filter((s) => !draftBySupplier.has(s));
  if (missingSuppliers.length > 0) {
    const { data: created, error: createErr } = await supabase
      .from("supply_orders")
      .insert(
        missingSuppliers.map((sid) => ({
          supplier_id: sid,
          status: "draft" as const,
          created_by: userId,
        }))
      )
      .select("id, supplier_id");

    if (createErr) {
      if (createErr.code === "23505") {
        // Race: another writer created at least one draft between our Phase 2
        // read and this insert. The transaction rolled back entirely, so we
        // re-fetch everyone we tried to create.
        const { data: refetched } = await supabase
          .from("supply_orders")
          .select("id, supplier_id")
          .in("supplier_id", missingSuppliers)
          .eq("status", "draft");
        for (const r of (refetched ?? []) as Array<{ id: string; supplier_id: string }>) {
          if (!draftBySupplier.has(r.supplier_id)) {
            draftBySupplier.set(r.supplier_id, r.id);
          }
        }
      }
      // Whoever still has no draft is a real failure; prune them with an error.
      const stillMissing = new Set(
        missingSuppliers.filter((s) => !draftBySupplier.has(s))
      );
      if (stillMissing.size > 0) {
        const surviving: Assigned[] = [];
        for (const a of assigned) {
          if (stillMissing.has(a.supplierId)) {
            results.push({
              variantId: a.variantId,
              supplierId: a.supplierId,
              outcome: "error",
              reason:
                createErr.code === "23505"
                  ? "Concurrent draft conflict — please retry"
                  : createErr.message,
            });
          } else {
            surviving.push(a);
          }
        }
        assigned = surviving;
      }
    } else if (created) {
      for (const c of created as Array<{ id: string; supplier_id: string }>) {
        draftBySupplier.set(c.supplier_id, c.id);
      }
    }
  }

  if (assigned.length === 0) {
    return ok({ added: 0, results });
  }

  // Latest (variant, supplier) cost — rows already DESC.
  const costKey = (vid: string, sid: string) => `${vid}|${sid}`;
  const latestCostByKey = new Map<
    string,
    { unit_cost: number; unit_cost_currency: string }
  >();
  for (const r of (lotRows ?? []) as Array<{
    variant_id: string;
    supplier_id: string;
    unit_cost: number;
    unit_cost_currency: string;
    received_at: string;
  }>) {
    const k = costKey(r.variant_id, r.supplier_id);
    if (!latestCostByKey.has(k)) {
      latestCostByKey.set(k, {
        unit_cost: Number(r.unit_cost),
        unit_cost_currency: r.unit_cost_currency,
      });
    }
  }

  // Resolve attribute_combo value labels in one batch for every assigned variant.
  const allValueIds = new Set<string>();
  for (const a of assigned) {
    const v = variantById.get(a.variantId);
    if (!v?.attribute_combo) continue;
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

  // Build candidate rows. We don't pre-filter against existing lines because
  // the upsert below is idempotent — the DB will skip duplicates and tell us
  // which ones it actually inserted, eliminating an entire round-trip and
  // making concurrent adds of the same variant safe.
  type InsertRow = {
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
  };
  const candidates: InsertRow[] = [];
  const supplierByVariant = new Map<string, string>();

  for (const a of assigned) {
    const supplyOrderId = draftBySupplier.get(a.supplierId);
    if (!supplyOrderId) continue;
    const variant = variantById.get(a.variantId);
    if (!variant) {
      results.push({
        variantId: a.variantId,
        supplierId: a.supplierId,
        outcome: "error",
        reason: "Variant not found",
      });
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
    const inv = invByVariant.get(a.variantId);
    const cost = latestCostByKey.get(costKey(a.variantId, a.supplierId));
    candidates.push({
      supply_order_id: supplyOrderId,
      variant_id: a.variantId,
      business_sku_at_draft: variant.sku,
      supplier_sku_at_draft: a.supplierSku,
      variant_label: variantLabel,
      qty_at_draft: inv?.quantity_available ?? null,
      threshold_at_draft: inv?.low_stock_threshold ?? null,
      ordered_qty: a.orderedQty,
      unit_cost: cost?.unit_cost ?? null,
      unit_cost_currency: cost?.unit_cost_currency ?? null,
    });
    supplierByVariant.set(a.variantId, a.supplierId);
  }

  // Phase 4 — bulk UPSERT with ON CONFLICT DO NOTHING. Returns only the rows
  // actually inserted; the rest were duplicates and stay untouched.
  let added = 0;
  if (candidates.length > 0) {
    const { data: insertedRows, error: insertErr } = await supabase
      .from("supply_order_lines")
      .upsert(candidates, {
        onConflict: "supply_order_id,variant_id",
        ignoreDuplicates: true,
      })
      .select("supply_order_id, variant_id");

    if (insertErr) {
      for (const row of candidates) {
        results.push({
          variantId: row.variant_id,
          supplierId: supplierByVariant.get(row.variant_id) ?? null,
          outcome: "error",
          reason: insertErr.message,
        });
      }
    } else {
      const lineKey = (oid: string, vid: string) => `${oid}|${vid}`;
      const insertedKeys = new Set<string>();
      for (const r of (insertedRows ?? []) as Array<{
        supply_order_id: string;
        variant_id: string;
      }>) {
        insertedKeys.add(lineKey(r.supply_order_id, r.variant_id));
      }
      added = insertedKeys.size;
      for (const row of candidates) {
        const key = lineKey(row.supply_order_id, row.variant_id);
        results.push({
          variantId: row.variant_id,
          supplierId: supplierByVariant.get(row.variant_id) ?? null,
          outcome: insertedKeys.has(key) ? "added" : "already_in_draft",
        });
      }
    }
  }

  if (userId) {
    await logAuditEvent({
      actor_id: userId,
      actor_type: "user",
      action: "supply_order.inventory_bulk_added_to_drafts",
      resource_type: "supply_order",
      metadata: {
        added,
        suppliers_touched: supplierIds,
        no_supplier_count: results.filter((r) => r.outcome === "no_supplier").length,
        already_in_draft_count: results.filter((r) => r.outcome === "already_in_draft").length,
        error_count: results.filter((r) => r.outcome === "error").length,
      },
    });
  }

  revalidatePath("/admin/supply-orders");
  revalidatePath("/admin/inventory");
  return ok({ added, results });
}
