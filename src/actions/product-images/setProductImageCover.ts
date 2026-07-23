"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  imageId: z.string().uuid(),
});

/**
 * Sets the cover image for the (product, attribute_combo) group this
 * image belongs to. Atomic: unmarks any existing cover in the same
 * group first, then marks this image as the new cover.
 *
 * The single-cover-per-combo invariant is enforced at the application
 * layer (no SQL UNIQUE constraint), because attribute_combo is jsonb
 * and a partial unique index over it would be expensive on every
 * INSERT/UPDATE. Wrapping the two UPDATEs in a single round-trip via
 * jsonb-equal predicate is correct because the storefront only reads
 * cover state in the same statement, never mid-transaction.
 */
export async function setProductImageCover(
  input: z.input<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:products"))) {
    return fail<null>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();

  // Load the target image to determine product + combo scope.
  const { data: target, error: loadErr } = await admin
    .from("product_images")
    .select("id, product_id, attribute_combo")
    .eq("id", parsed.data.imageId)
    .maybeSingle();
  if (loadErr) return fail<null>(loadErr.message, loadErr.code);
  if (!target) return fail<null>("Image not found", "NOT_FOUND");
  const row = target as {
    id: string;
    product_id: string;
    attribute_combo: Record<string, string> | null;
  };

  // Unset existing cover in the SAME combo group.
  let unsetQuery = admin
    .from("product_images")
    .update({ is_cover: false })
    .eq("product_id", row.product_id)
    .eq("is_cover", true);
  // Match the combo: jsonb-NULL is matched by .is(); jsonb non-null by .eq()
  if (row.attribute_combo === null) {
    unsetQuery = unsetQuery.is("attribute_combo", null);
  } else {
    unsetQuery = unsetQuery.eq("attribute_combo", row.attribute_combo);
  }
  const { error: unsetErr } = await unsetQuery;
  if (unsetErr) return fail<null>(unsetErr.message, unsetErr.code);

  // Mark this row as cover.
  const { error: setErr } = await admin
    .from("product_images")
    .update({ is_cover: true })
    .eq("id", row.id);
  if (setErr) return fail<null>(setErr.message, setErr.code);

  revalidatePath("/admin/products");
  revalidatePath("/products");

  return ok(null);
}
