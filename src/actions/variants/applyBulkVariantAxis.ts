"use server";

import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { addMatrixCombos } from "@/actions/variants/addMatrixCombos";
import {
  planBulkAxisAdditions,
  type VariantComboRow,
} from "@/lib/variants/bulkAxisExpansion";
import { MAX_BULK_OPERATION } from "@/lib/bulk-selection/selectionUrl";
import { fail, ok, type Result } from "@/types/result";

/**
 * Apply the additive bulk variant-axis op: for each selected product that
 * lacks the chosen value(s) on `attributeSlug`, create the missing combos
 * via addMatrixCombos. Additive only — never removes or overwrites
 * existing variants (those stay single-product operations).
 */
export async function applyBulkVariantAxis(input: {
  productIds: string[];
  attributeSlug: string;
  valueIds: string[];
}): Promise<Result<{ affectedProducts: number; createdCombos: number }>> {
  if (!(await checkPermission("manage:products"))) {
    return fail<{ affectedProducts: number; createdCombos: number }>(
      "Forbidden",
      "FORBIDDEN"
    );
  }
  if (!input.attributeSlug || input.valueIds.length === 0) {
    return fail<{ affectedProducts: number; createdCombos: number }>(
      "Επιλέξτε άξονα και τουλάχιστον μία τιμή.",
      "INVALID_INPUT"
    );
  }
  if (
    input.productIds.length === 0 ||
    input.productIds.length > MAX_BULK_OPERATION
  ) {
    return fail<{ affectedProducts: number; createdCombos: number }>(
      `Η επιλογή πρέπει να είναι 1–${MAX_BULK_OPERATION} προϊόντα.`,
      "OVER_CAP"
    );
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

  let createdCombos = 0;
  let firstError: string | undefined;
  for (const [productId, combos] of plan.perProduct) {
    const r = await addMatrixCombos({ productId, combos });
    if (r.success) {
      // addMatrixCombos re-dedupes/handles races — trust its `created`
      // count, not the planned combos.length.
      createdCombos += r.data.created;
    } else if (!firstError) {
      firstError = r.error;
    }
  }
  if (firstError) {
    return fail<{ affectedProducts: number; createdCombos: number }>(
      firstError,
      "BULK_AXIS_FAILED"
    );
  }
  return ok({ affectedProducts: plan.perProduct.size, createdCombos });
}
