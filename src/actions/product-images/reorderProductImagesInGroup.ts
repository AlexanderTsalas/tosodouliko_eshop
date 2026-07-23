"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  productId: z.string().uuid(),
  /** The combo group whose order is being persisted. Empty = general. */
  attributeCombo: z.record(z.string(), z.string()).default({}),
  /** Image IDs in their new order, top to bottom. */
  imageIdsInOrder: z.array(z.string().uuid()).min(1),
});

/**
 * Persists drag-and-drop reordering within a single attribute_combo
 * group. The display_order column reflects the array index of each
 * image in `imageIdsInOrder`.
 *
 * The legacy reorderProductImages action ordered all of a product's
 * images flat; this combo-aware version scopes ordering to a group so
 * reorders in the "Red" group don't disturb the "Blue" group.
 *
 * Verification: every imageId must belong to (productId, combo) — a
 * drag-and-drop UI shouldn't let cross-group IDs into the same call,
 * but we check defensively.
 */
export async function reorderProductImagesInGroup(
  input: z.input<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:products"))) {
    return fail<null>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();
  const combo =
    Object.keys(parsed.data.attributeCombo).length === 0
      ? null
      : parsed.data.attributeCombo;

  // Verify all IDs belong to the same (product, combo) group.
  const verifyQuery = admin
    .from("product_images")
    .select("id, attribute_combo")
    .eq("product_id", parsed.data.productId)
    .in("id", parsed.data.imageIdsInOrder);
  const { data: rows, error: vErr } = await verifyQuery;
  if (vErr) return fail<null>(vErr.message, vErr.code);
  if (!rows || rows.length !== parsed.data.imageIdsInOrder.length) {
    return fail<null>(
      "Image set mismatch — some IDs don't belong to this product.",
      "INVALID_INPUT"
    );
  }
  const mismatched = (rows as Array<{
    id: string;
    attribute_combo: Record<string, string> | null;
  }>).filter((r) => !sameCombo(r.attribute_combo, combo));
  if (mismatched.length > 0) {
    return fail<null>(
      "Cross-group reorder rejected — drag-and-drop should only reorder within one group.",
      "CROSS_GROUP_REORDER"
    );
  }

  // Bulk UPDATE display_order. The simplest pattern is N parallel
  // .update().eq("id", X) calls; for typical group sizes (3-10 images)
  // this is fast enough. For larger groups, switch to a CASE-expression
  // bulk UPDATE.
  const nowIso = new Date().toISOString();
  await Promise.all(
    parsed.data.imageIdsInOrder.map((id, idx) =>
      admin
        .from("product_images")
        .update({ display_order: idx })
        .eq("id", id)
    )
  );

  // touch_updated_at trigger handles updated_at on a per-row basis;
  // nothing extra needed.
  void nowIso; // (kept for future use if we ever batch-stamp)

  revalidatePath("/admin/products");
  revalidatePath("/products");

  return ok(null);
}

function sameCombo(
  a: Record<string, string> | null,
  b: Record<string, string> | null
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k] === b[k]);
}
