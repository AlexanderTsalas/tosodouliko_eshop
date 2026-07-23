import { createClient } from "@/lib/supabase/server";

/**
 * Returns the latest purchase_lots row for (variant × supplier), or null if
 * none exist yet. Cheap point-lookup hitting the
 * (variant_id, supplier_id, received_at DESC) index.
 *
 * Used wherever a single cost number is needed: variant pricing tab,
 * reorder draft snapshot, etc.
 */
export async function getCurrentSupplierCost(
  variantId: string,
  supplierId: string
): Promise<{ unit_cost: number; unit_cost_currency: string; received_at: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_lots")
    .select("unit_cost, unit_cost_currency, received_at")
    .eq("variant_id", variantId)
    .eq("supplier_id", supplierId)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const row = data as { unit_cost: number; unit_cost_currency: string; received_at: string };
  return {
    unit_cost: Number(row.unit_cost),
    unit_cost_currency: row.unit_cost_currency,
    received_at: row.received_at,
  };
}
