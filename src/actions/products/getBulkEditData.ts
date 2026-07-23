"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/rbac";
import { resolveProductIds } from "@/lib/bulk-selection/resolveProductIds";
import type { AdminProductFilterParams } from "@/lib/admin-products-filter/productFilters";
import type { VatRate } from "@/types/vat-rates";
import type { Supplier } from "@/types/suppliers";
import type { Category } from "@/types/category-navigation";
import type { Attribute, AttributeValue } from "@/types/attribute-facets";
import type { VolumetricPrefix } from "@/types/volumetric";

/**
 * Resolves a bulk selection (explicit ids or matchAll+filters) into a
 * concrete product set + the dropdown data the bulk-edit form needs.
 * Powers the panel's bulk-edit mode (replaces the standalone
 * /admin/products/bulk-edit route). Returns an error state for empty /
 * over-cap selections so the panel can show it inline.
 */
export async function getBulkEditData(input: {
  selectedIds: string[];
  matchAll: boolean;
  filterParams?: AdminProductFilterParams;
}): Promise<
  | { ok: false; error: string }
  | {
      ok: true;
      productIds: string[];
      matchAll: boolean;
      filterParams?: AdminProductFilterParams;
      affectedCount: number;
      vatRates: VatRate[];
      suppliers: Supplier[];
      categories: Category[];
      attributes: Attribute[];
      attributeValues: AttributeValue[];
      volumetricPrefixes: VolumetricPrefix[];
    }
> {
  await requirePermission("manage:products");

  const resolved = await resolveProductIds({
    ids: input.matchAll ? null : input.selectedIds,
    matchAll: input.matchAll,
    filterParams: input.matchAll ? input.filterParams : undefined,
  });
  if (!resolved.ok) return { ok: false, error: resolved.error };
  if (resolved.ids.length === 0) {
    return { ok: false, error: "Δεν επιλέχθηκε κανένα προϊόν." };
  }

  const supabase = await createClient();
  const [vatRatesRes, suppliersRes, categoriesRes, attrsRes, attrValsRes, volPrefsRes] =
    await Promise.all([
      supabase.from("vat_rates").select("*").order("rate"),
      supabase.from("suppliers").select("*").eq("active", true).order("name"),
      supabase
        .from("categories")
        .select("*")
        .eq("active", true)
        .order("display_order"),
      supabase.from("attributes").select("*").order("name"),
      supabase.from("attribute_values").select("*").order("display_order"),
      supabase
        .from("volumetric_prefixes")
        .select("*")
        .eq("active", true)
        .order("display_order", { ascending: true })
        .order("display_name", { ascending: true }),
    ]);

  return {
    ok: true,
    // Always the resolver's output — it enforces the MAX_BULK_OPERATION
    // cap and (for matchAll) the concrete id set. Returning raw
    // input.selectedIds would leak un-capped client input downstream.
    productIds: resolved.ids,
    matchAll: input.matchAll,
    filterParams: input.matchAll ? input.filterParams : undefined,
    affectedCount: resolved.ids.length,
    vatRates: (vatRatesRes.data ?? []) as VatRate[],
    suppliers: (suppliersRes.data ?? []) as Supplier[],
    categories: (categoriesRes.data ?? []) as Category[],
    attributes: (attrsRes.data ?? []) as Attribute[],
    attributeValues: (attrValsRes.data ?? []) as AttributeValue[],
    volumetricPrefixes: (volPrefsRes.data ?? []) as VolumetricPrefix[],
  };
}
