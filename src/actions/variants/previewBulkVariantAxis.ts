"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/rbac";
import {
  planBulkAxisAdditions,
  type VariantComboRow,
} from "@/lib/variants/bulkAxisExpansion";
import { MAX_BULK_OPERATION } from "@/lib/bulk-selection/selectionUrl";

/**
 * Dry-run for the bulk additive variant-axis op: how many products would
 * gain each value + total new combos. Feeds the confirm modal's breakdown
 * without writing anything.
 */
export async function previewBulkVariantAxis(input: {
  productIds: string[];
  attributeSlug: string;
  valueIds: string[];
}): Promise<
  | { ok: false; error: string }
  | {
      ok: true;
      affectedProducts: number;
      totalCombos: number;
      perValueProductCount: Record<string, number>;
    }
> {
  await requirePermission("manage:products");
  if (!input.attributeSlug || input.valueIds.length === 0) {
    return { ok: false, error: "Επιλέξτε άξονα και τουλάχιστον μία τιμή." };
  }
  if (
    input.productIds.length === 0 ||
    input.productIds.length > MAX_BULK_OPERATION
  ) {
    return {
      ok: false,
      error: `Η επιλογή πρέπει να είναι 1–${MAX_BULK_OPERATION} προϊόντα.`,
    };
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("product_variants")
    .select("product_id, attribute_combo")
    .in("product_id", input.productIds);
  const plan = planBulkAxisAdditions(
    (data ?? []) as VariantComboRow[],
    input.productIds,
    input.attributeSlug,
    input.valueIds
  );
  return {
    ok: true,
    affectedProducts: plan.affectedProducts,
    totalCombos: plan.totalCombos,
    perValueProductCount: plan.perValueProductCount,
  };
}
