"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { RelatedProductsManualPick } from "@/types/related-products";

const Schema = z.object({
  association_id: z.string().uuid(),
  product_id: z.string().uuid(),
});

/**
 * Appends a product to the manual-picks list of an association at the
 * next sort_order (max+1). Rejected with DUPLICATE_PICK if the product
 * is already in the list (unique constraint).
 *
 * Manual picks only have effect when association.selection_strategy =
 * 'manual'; for other strategies they're stored but ignored at
 * resolution time. We don't gate writes on strategy because admins
 * often toggle strategy back and forth while exploring.
 */
export async function addManualPick(
  input: z.input<typeof Schema>
): Promise<Result<RelatedProductsManualPick>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<RelatedProductsManualPick>(
      "Invalid input",
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<RelatedProductsManualPick>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("related_products_manual_picks")
    .select("sort_order")
    .eq("association_id", parsed.data.association_id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = existing
    ? ((existing as { sort_order: number }).sort_order ?? 0) + 1
    : 0;

  const { data: row, error } = await admin
    .from("related_products_manual_picks")
    .insert({
      association_id: parsed.data.association_id,
      product_id: parsed.data.product_id,
      sort_order: nextSort,
    })
    .select()
    .single();

  if (error || !row) {
    if (error?.code === "23505") {
      return fail<RelatedProductsManualPick>(
        "Το προϊόν είναι ήδη στη λίστα.",
        "DUPLICATE_PICK"
      );
    }
    return fail<RelatedProductsManualPick>(
      "Failed to add pick: " + error?.message,
      error?.code
    );
  }

  revalidatePath("/admin/related-products");
  return ok(row as RelatedProductsManualPick);
}
