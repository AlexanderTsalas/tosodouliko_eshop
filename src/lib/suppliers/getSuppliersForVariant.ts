import { createClient } from "@/lib/supabase/server";
import type { SupplierCurrentCost } from "@/types/suppliers";

const STALE_THRESHOLD_DAYS = 60;

/**
 * For a single variant, return the composed "current cost per supplier" view:
 * supplier_products rows joined to their latest purchase_lots row, plus
 * computed flags (cheapest, stale, no-history).
 *
 * Used by:
 *   - the "Needs choice" bucket on the Supply Orders Drafts page
 *   - the variant details tab's Suppliers sub-panel
 *   - the supplier picker in any variant context
 *
 * Returns an empty array for unknown variants — no error.
 */
export async function getSuppliersForVariant(
  variantId: string
): Promise<SupplierCurrentCost[]> {
  const supabase = await createClient();

  // 1. Active supplier_products rows + the supplier's name in one round-trip.
  const { data: spRows } = await supabase
    .from("supplier_products")
    .select("id, supplier_id, supplier_sku, lead_time_days, is_preferred, suppliers(name)")
    .eq("variant_id", variantId)
    .eq("active", true);

  const links = (spRows ?? []) as Array<{
    id: string;
    supplier_id: string;
    supplier_sku: string | null;
    lead_time_days: number | null;
    is_preferred: boolean;
    suppliers: { name: string } | { name: string }[] | null;
  }>;

  if (links.length === 0) return [];

  const supplierIds = links.map((l) => l.supplier_id);

  // 2. Latest purchase_lots row per supplier (for this variant).
  //    DISTINCT ON exploits the (variant_id, supplier_id, received_at DESC) index.
  const { data: lotRows } = await supabase
    .from("purchase_lots")
    .select("supplier_id, unit_cost, unit_cost_currency, received_at")
    .eq("variant_id", variantId)
    .in("supplier_id", supplierIds)
    .order("supplier_id")
    .order("received_at", { ascending: false });

  // Pick the latest row per supplier_id from the descending list.
  const latestBySupplier = new Map<
    string,
    { unit_cost: number; unit_cost_currency: string; received_at: string }
  >();
  for (const row of (lotRows ?? []) as Array<{
    supplier_id: string | null;
    unit_cost: number;
    unit_cost_currency: string;
    received_at: string;
  }>) {
    if (!row.supplier_id) continue;
    if (latestBySupplier.has(row.supplier_id)) continue;
    latestBySupplier.set(row.supplier_id, {
      unit_cost: Number(row.unit_cost),
      unit_cost_currency: row.unit_cost_currency,
      received_at: row.received_at,
    });
  }

  // 3. Compose the result rows.
  const staleCutoff = Date.now() - STALE_THRESHOLD_DAYS * 86_400_000;
  const composed: SupplierCurrentCost[] = links.map((l) => {
    const supplierObj = Array.isArray(l.suppliers) ? l.suppliers[0] : l.suppliers;
    const lot = latestBySupplier.get(l.supplier_id) ?? null;
    return {
      supplier_product_id: l.id,
      supplier_id: l.supplier_id,
      supplier_name: supplierObj?.name ?? "(unknown)",
      supplier_sku: l.supplier_sku,
      lead_time_days: l.lead_time_days,
      is_preferred: l.is_preferred,
      last_unit_cost: lot?.unit_cost ?? null,
      last_unit_cost_currency: lot?.unit_cost_currency ?? null,
      last_received_at: lot?.received_at ?? null,
      is_cheapest: false,
      is_stale:
        lot !== null && new Date(lot.received_at).getTime() < staleCutoff,
      has_no_history: lot === null,
    };
  });

  // 4. Flag the cheapest among those that have a cost.
  let cheapest: SupplierCurrentCost | null = null;
  for (const c of composed) {
    if (c.last_unit_cost === null) continue;
    if (!cheapest || c.last_unit_cost < cheapest.last_unit_cost!) cheapest = c;
  }
  if (cheapest) cheapest.is_cheapest = true;

  return composed;
}
