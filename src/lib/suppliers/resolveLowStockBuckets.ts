import { createClient } from "@/lib/supabase/server";
import { stockStatus } from "@/types/inventory-sync";
import type {
  LowStockBuckets,
  LowStockVariant,
  PlacedSupplyLine,
  SupplierCurrentCost,
} from "@/types/suppliers";

const STALE_THRESHOLD_DAYS = 60;

/**
 * Builds the three-bucket view the Supply Orders Drafts page renders:
 *   - bySupplier   variants with exactly one supplier (straight into a draft)
 *   - multiSource  variants with >1 supplier (admin picks at order-time)
 *   - unassigned   variants with no supplier link yet (shown as a warning)
 *
 * Excludes variants whose track_supply = false.
 * Excludes variants already attached to an existing open Draft for the same
 * supplier (so re-rendering the page after adding to a draft doesn't
 * re-suggest the same item).
 */
export async function resolveLowStockBuckets(): Promise<LowStockBuckets> {
  const supabase = await createClient();

  // 1. All inventory rows joined to variants + their parent product. We
  //    fetch everything once and filter in memory — the catalog is small
  //    enough that this is cheaper than chained queries.
  const { data: inv } = await supabase
    .from("inventory_items")
    .select(`
      variant_id,
      quantity_available,
      low_stock_threshold,
      product_variants!inner(
        id,
        sku,
        attribute_combo,
        price,
        track_supply,
        is_active,
        products(id, name, active)
      )
    `);

  type Row = {
    variant_id: string;
    quantity_available: number;
    low_stock_threshold: number;
    product_variants: {
      id: string;
      sku: string;
      attribute_combo: Record<string, string> | null;
      price: number;
      track_supply: boolean;
      is_active: boolean;
      products: { id: string; name: string; active: boolean } | { id: string; name: string; active: boolean }[] | null;
    } | {
      id: string;
      sku: string;
      attribute_combo: Record<string, string> | null;
      price: number;
      track_supply: boolean;
      is_active: boolean;
      products: { id: string; name: string; active: boolean } | { id: string; name: string; active: boolean }[] | null;
    }[];
  };

  // Filter to low/out variants that are trackable + on an active product.
  const lowVariantIds: string[] = [];
  const variantMeta = new Map<string, {
    product_id: string;
    product_name: string;
    business_sku: string;
    variant_label: string | null;
    quantity_available: number;
    low_stock_threshold: number;
    sale_price: number;
    status: "low" | "out";
  }>();

  // First pass: gather low/out rows and the value UUIDs we'll need to render.
  type Pv = {
    id: string;
    sku: string;
    attribute_combo: Record<string, string> | null;
    price: number;
    track_supply: boolean;
    is_active: boolean;
    products:
      | { id: string; name: string; active: boolean }
      | { id: string; name: string; active: boolean }[]
      | null;
  };
  type Pending = {
    row: Row;
    pv: Pv;
    product: { id: string; name: string; active: boolean };
    status: "low" | "out";
  };
  const pending: Pending[] = [];
  const allValueIds = new Set<string>();
  for (const row of (inv ?? []) as Row[]) {
    const pv = (Array.isArray(row.product_variants)
      ? row.product_variants[0]
      : row.product_variants) as Pv | undefined;
    if (!pv || !pv.track_supply || !pv.is_active) continue;
    const product = Array.isArray(pv.products) ? pv.products[0] : pv.products;
    if (!product || !product.active) continue;
    const status = stockStatus({
      quantity_available: row.quantity_available,
      low_stock_threshold: row.low_stock_threshold,
    });
    if (status !== "low" && status !== "out") continue;
    pending.push({ row, pv, product, status });
    if (pv.attribute_combo) {
      for (const id of Object.values(pv.attribute_combo)) allValueIds.add(id);
    }
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

  for (const { row, pv, product, status } of pending) {
    let variantLabel: string | null = null;
    if (pv.attribute_combo) {
      const labels = Object.values(pv.attribute_combo)
        .map((id) => valueLabelById.get(id))
        .filter((s): s is string => typeof s === "string");
      if (labels.length > 0) variantLabel = labels.join(" · ");
    }
    lowVariantIds.push(row.variant_id);
    variantMeta.set(row.variant_id, {
      product_id: product.id,
      product_name: product.name,
      business_sku: pv.sku,
      variant_label: variantLabel,
      quantity_available: row.quantity_available,
      low_stock_threshold: row.low_stock_threshold,
      sale_price: Number(pv.price),
      status,
    });
  }

  if (lowVariantIds.length === 0) {
    return {
      bySupplier: new Map(),
      multiSource: [],
      unassigned: [],
      placedBySupplier: new Map(),
    };
  }

  // 2. Fetch both draft and placed lines for the low variants in one shot.
  //    We then split them:
  //      - draftedVariantIds: drop from suggestions entirely (already in a draft)
  //      - placedBySupplier:  feed to the page for the "awaiting delivery" block,
  //                           AND use to suppress same-supplier suggestions so
  //                           we don't nag the admin to re-order what they just
  //                           sent off.
  //
  //    Querying from supply_orders is more robust than the previous
  //    supply_order_lines + !inner(status) shape (see admin/inventory page
  //    rewrite for the reasoning).
  const { data: openOrders } = await supabase
    .from("supply_orders")
    .select(
      "id, status, supplier_id, placed_at, supply_order_lines(id, variant_id, business_sku_at_draft, variant_label, ordered_qty, unit_cost, unit_cost_currency)"
    )
    .in("status", ["draft", "placed"]);

  const draftedVariantIds = new Set<string>();
  const placedBySupplier = new Map<string, PlacedSupplyLine[]>();
  const placedByVariant = new Map<string, Set<string>>(); // variant_id → set of supplier_ids

  for (const order of (openOrders ?? []) as Array<{
    id: string;
    status: "draft" | "placed";
    supplier_id: string;
    placed_at: string | null;
    supply_order_lines:
      | Array<{
          id: string;
          variant_id: string;
          business_sku_at_draft: string;
          variant_label: string | null;
          ordered_qty: number;
          unit_cost: number | null;
          unit_cost_currency: string | null;
        }>
      | null;
  }>) {
    for (const line of order.supply_order_lines ?? []) {
      if (order.status === "draft") {
        draftedVariantIds.add(line.variant_id);
      } else {
        // placed — rely on the snapshot fields, no variant metadata lookup needed.
        const list = placedBySupplier.get(order.supplier_id) ?? [];
        list.push({
          line_id: line.id,
          supply_order_id: order.id,
          variant_id: line.variant_id,
          variant_label: line.variant_label,
          business_sku_at_draft: line.business_sku_at_draft,
          ordered_qty: line.ordered_qty,
          unit_cost: line.unit_cost,
          unit_cost_currency: line.unit_cost_currency,
          placed_at: order.placed_at,
        });
        placedBySupplier.set(order.supplier_id, list);

        const supplierSet = placedByVariant.get(line.variant_id) ?? new Set<string>();
        supplierSet.add(order.supplier_id);
        placedByVariant.set(line.variant_id, supplierSet);
      }
    }
  }

  // 3. supplier_products + latest cost for each remaining variant.
  const remainingIds = lowVariantIds.filter((id) => !draftedVariantIds.has(id));
  if (remainingIds.length === 0) {
    return {
      bySupplier: new Map(),
      multiSource: [],
      unassigned: [],
      placedBySupplier,
    };
  }

  const { data: spRows } = await supabase
    .from("supplier_products")
    .select("id, variant_id, supplier_id, supplier_sku, lead_time_days, is_preferred, suppliers(name)")
    .in("variant_id", remainingIds)
    .eq("active", true);

  const linksByVariant = new Map<string, Array<{
    id: string;
    supplier_id: string;
    supplier_sku: string | null;
    lead_time_days: number | null;
    is_preferred: boolean;
    supplier_name: string;
  }>>();
  for (const row of (spRows ?? []) as Array<{
    id: string;
    variant_id: string;
    supplier_id: string;
    supplier_sku: string | null;
    lead_time_days: number | null;
    is_preferred: boolean;
    suppliers: { name: string } | { name: string }[] | null;
  }>) {
    const supplierObj = Array.isArray(row.suppliers) ? row.suppliers[0] : row.suppliers;
    const list = linksByVariant.get(row.variant_id) ?? [];
    list.push({
      id: row.id,
      supplier_id: row.supplier_id,
      supplier_sku: row.supplier_sku,
      lead_time_days: row.lead_time_days,
      is_preferred: row.is_preferred,
      supplier_name: supplierObj?.name ?? "(unknown)",
    });
    linksByVariant.set(row.variant_id, list);
  }

  // 4. Latest purchase_lots per (variant, supplier) for the remaining set.
  const { data: lotRows } = await supabase
    .from("purchase_lots")
    .select("variant_id, supplier_id, unit_cost, unit_cost_currency, received_at")
    .in("variant_id", remainingIds)
    .order("received_at", { ascending: false });

  const latestByKey = new Map<string, { unit_cost: number; unit_cost_currency: string; received_at: string }>();
  for (const row of (lotRows ?? []) as Array<{
    variant_id: string;
    supplier_id: string | null;
    unit_cost: number;
    unit_cost_currency: string;
    received_at: string;
  }>) {
    if (!row.supplier_id) continue;
    const key = `${row.variant_id}::${row.supplier_id}`;
    if (latestByKey.has(key)) continue;
    latestByKey.set(key, {
      unit_cost: Number(row.unit_cost),
      unit_cost_currency: row.unit_cost_currency,
      received_at: row.received_at,
    });
  }

  // 5. Compose LowStockVariant per remaining id, then bucket.
  const staleCutoff = Date.now() - STALE_THRESHOLD_DAYS * 86_400_000;
  const bySupplier = new Map<string, LowStockVariant[]>();
  const multiSource: LowStockVariant[] = [];
  const unassigned: LowStockVariant[] = [];

  for (const vid of remainingIds) {
    const meta = variantMeta.get(vid)!;
    const allLinks = linksByVariant.get(vid) ?? [];
    const placedSuppliers = placedByVariant.get(vid) ?? new Set<string>();

    // Drop supplier_products entries whose supplier already has this variant
    // on a placed order — that variant should appear in that supplier's
    // "awaiting delivery" block instead of being re-suggested here.
    const links = allLinks.filter((l) => !placedSuppliers.has(l.supplier_id));

    const suppliers: SupplierCurrentCost[] = links.map((l) => {
      const lot = latestByKey.get(`${vid}::${l.supplier_id}`);
      return {
        supplier_product_id: l.id,
        supplier_id: l.supplier_id,
        supplier_name: l.supplier_name,
        supplier_sku: l.supplier_sku,
        lead_time_days: l.lead_time_days,
        is_preferred: l.is_preferred,
        last_unit_cost: lot?.unit_cost ?? null,
        last_unit_cost_currency: lot?.unit_cost_currency ?? null,
        last_received_at: lot?.received_at ?? null,
        is_cheapest: false,
        is_stale: lot !== null && lot !== undefined && new Date(lot.received_at).getTime() < staleCutoff,
        has_no_history: lot === null || lot === undefined,
      };
    });

    // Flag cheapest within this variant.
    let cheapest: SupplierCurrentCost | null = null;
    for (const s of suppliers) {
      if (s.last_unit_cost === null) continue;
      if (!cheapest || s.last_unit_cost < cheapest.last_unit_cost!) cheapest = s;
    }
    if (cheapest) cheapest.is_cheapest = true;

    const lsv: LowStockVariant = {
      variant_id: vid,
      product_id: meta.product_id,
      product_name: meta.product_name,
      variant_label: meta.variant_label,
      business_sku: meta.business_sku,
      quantity_available: meta.quantity_available,
      low_stock_threshold: meta.low_stock_threshold,
      sale_price: meta.sale_price,
      status: meta.status,
      suppliers,
    };

    // Bucket by the count of *remaining* (unplaced-at-that-supplier) links.
    // The unassigned bucket still refers to "no supplier_products entries at
    // all" — a variant whose only supplier already has it placed simply drops
    // out of suggestions (its row lives in the awaiting-delivery list).
    if (allLinks.length === 0) {
      unassigned.push(lsv);
    } else if (links.length === 0) {
      // Already placed at every linked supplier — nothing to suggest.
      continue;
    } else if (links.length === 1) {
      const list = bySupplier.get(links[0].supplier_id) ?? [];
      list.push(lsv);
      bySupplier.set(links[0].supplier_id, list);
    } else {
      multiSource.push(lsv);
    }
  }

  return { bySupplier, multiSource, unassigned, placedBySupplier };
}
