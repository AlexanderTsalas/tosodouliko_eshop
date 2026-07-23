"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/rbac";
import { getSuppliersForVariant } from "@/lib/suppliers/getSuppliersForVariant";
import type { Supplier, SupplierCurrentCost } from "@/types/suppliers";

/**
 * Extended per-variant data for the variant card's "more" expander —
 * suppliers (composed cost view), the OOS-visibility override + the
 * resolved inherited value, and the track-supply flag. Lazy-loaded only
 * when an admin expands a specific variant, so the main panel open stays
 * cheap.
 */
export async function getVariantExtras(variantId: string): Promise<{
  suppliers: SupplierCurrentCost[];
  allSuppliers: Supplier[];
  /** Variant's own override (null = inherit). */
  showWhenOos: boolean | null;
  trackSupply: boolean;
  /** What the variant inherits when its override is null: product → global. */
  inheritedShowWhenOos: boolean;
}> {
  await requirePermission("manage:products");
  const supabase = await createClient();

  const { data: variantRow } = await supabase
    .from("product_variants")
    .select("show_when_oos, track_supply, product_id")
    .eq("id", variantId)
    .maybeSingle();
  const v = variantRow as {
    show_when_oos: boolean | null;
    track_supply: boolean;
    product_id: string;
  } | null;

  const [suppliers, allSuppliersRes, settingsRes, productRes] =
    await Promise.all([
      getSuppliersForVariant(variantId),
      supabase.from("suppliers").select("*").order("name"),
      supabase
        .from("storefront_settings")
        .select("show_when_oos_default")
        .eq("id", 1)
        .maybeSingle(),
      v?.product_id
        ? supabase
            .from("products")
            .select("show_when_oos")
            .eq("id", v.product_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const globalDefault = Boolean(
    (settingsRes.data as { show_when_oos_default: boolean } | null)
      ?.show_when_oos_default
  );
  const productShow =
    (productRes.data as { show_when_oos: boolean | null } | null)
      ?.show_when_oos ?? null;
  const inheritedShowWhenOos = productShow ?? globalDefault;

  return {
    suppliers,
    allSuppliers: (allSuppliersRes.data ?? []) as Supplier[],
    showWhenOos: v?.show_when_oos ?? null,
    trackSupply: v?.track_supply ?? true,
    inheritedShowWhenOos,
  };
}
