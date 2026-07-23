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
 * Removes a product_images row, promoting another image in the same
 * attribute_combo group to cover if the deleted image was the cover.
 *
 * **Does NOT delete the media_assets row or the storage bytes.** The
 * media_asset stays in the library for reuse. Orphan reaper cleans up
 * stranded storage objects whose media_asset isn't referenced by any
 * product_images row within 24h.
 *
 * This complements (not replaces) the legacy deleteProductImage
 * action; the new flow lives at this name to make the intent explicit:
 *   "remove association, leave file intact, promote cover if needed."
 */
export async function deleteProductImageWithCoverPromotion(
  input: z.input<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:products"))) {
    return fail<null>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();

  // Load to determine cover bookkeeping needed.
  const { data: target, error: loadErr } = await admin
    .from("product_images")
    .select("id, product_id, attribute_combo, is_cover")
    .eq("id", parsed.data.imageId)
    .maybeSingle();
  if (loadErr) return fail<null>(loadErr.message, loadErr.code);
  if (!target) return fail<null>("Image not found", "NOT_FOUND");
  const row = target as {
    id: string;
    product_id: string;
    attribute_combo: Record<string, string> | null;
    is_cover: boolean;
  };

  // Delete the row.
  const { error: delErr } = await admin
    .from("product_images")
    .delete()
    .eq("id", row.id);
  if (delErr) return fail<null>(delErr.message, delErr.code);

  // If was cover: promote the next image in the same combo group.
  if (row.is_cover) {
    let successorQuery = admin
      .from("product_images")
      .select("id")
      .eq("product_id", row.product_id)
      .order("display_order", { ascending: true })
      .limit(1);
    if (row.attribute_combo === null) {
      successorQuery = successorQuery.is("attribute_combo", null);
    } else {
      successorQuery = successorQuery.eq("attribute_combo", row.attribute_combo);
    }
    const { data: successor } = await successorQuery;
    if (successor && successor.length > 0) {
      await admin
        .from("product_images")
        .update({ is_cover: true })
        .eq("id", (successor[0] as { id: string }).id);
    }
    // If no successor: the group is now empty. That's fine — no cover
    // needed for an empty group.
  }

  revalidatePath("/admin/products");
  revalidatePath("/products");

  return ok(null);
}
