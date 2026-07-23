"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { ProductImage } from "@/types/products";

const Schema = z.object({
  imageId: z.string().uuid(),
  /** Alt-text payload:
   *  - undefined → no change
   *  - string    → manual override (flips alt_text_is_auto to false)
   *  - null      → reset to auto-generated mode (alt_text_is_auto=true,
   *                actual text re-derives on next refresh). */
  altText: z.string().max(500).nullable().optional(),
  /** Reassign to a different attribute_combo group within the product. */
  attributeCombo: z.record(z.string(), z.string()).optional(),
});

/**
 * Edit per-image metadata: alt text and/or attribute_combo
 * reassignment.
 *
 * When altText is provided, alt_text_is_auto flips to false so that
 * future product-name / attribute-label changes don't overwrite the
 * admin's manual override.
 *
 * When attributeCombo is provided, the image is reassigned to a
 * different group. If it was the cover of its old group, that group
 * loses its cover (the next-lowest display_order image in the old
 * group is promoted to cover). If the image is the FIRST in its new
 * group, it becomes the cover of the new group.
 *
 * Display_order on the new group: appended at the end (max + 1) to
 * avoid renumbering siblings.
 */
export async function updateProductImage(
  input: z.input<typeof Schema>
): Promise<Result<ProductImage>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<ProductImage>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<ProductImage>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();

  // Load current state.
  const { data: target, error: loadErr } = await admin
    .from("product_images")
    .select(
      "id, product_id, attribute_combo, is_cover, display_order, alt_text, alt_text_is_auto"
    )
    .eq("id", parsed.data.imageId)
    .maybeSingle();
  if (loadErr) return fail<ProductImage>(loadErr.message, loadErr.code);
  if (!target) return fail<ProductImage>("Image not found", "NOT_FOUND");
  const row = target as {
    id: string;
    product_id: string;
    attribute_combo: Record<string, string> | null;
    is_cover: boolean;
    display_order: number;
    alt_text: string | null;
    alt_text_is_auto: boolean;
  };

  // Build update patch.
  const patch: Record<string, unknown> = {};

  if (parsed.data.altText !== undefined) {
    if (parsed.data.altText === null) {
      // Reset to auto-generated mode. The actual text is cleared so a
      // subsequent generator (trigger/cron) can refill it.
      patch.alt_text = null;
      patch.alt_text_is_auto = true;
    } else {
      patch.alt_text = parsed.data.altText;
      patch.alt_text_is_auto = false;
    }
  }

  // Attribute-combo reassignment: handle is_cover bookkeeping in the
  // OLD group and NEW group.
  if (parsed.data.attributeCombo !== undefined) {
    const newCombo =
      Object.keys(parsed.data.attributeCombo).length === 0
        ? null
        : parsed.data.attributeCombo;
    patch.attribute_combo = newCombo;

    // If this image was the cover of its old group, promote another
    // image in that old group to cover (lowest display_order survivor).
    if (row.is_cover) {
      let oldGroupQuery = admin
        .from("product_images")
        .select("id, display_order")
        .eq("product_id", row.product_id)
        .neq("id", row.id)
        .order("display_order", { ascending: true })
        .limit(1);
      if (row.attribute_combo === null) {
        oldGroupQuery = oldGroupQuery.is("attribute_combo", null);
      } else {
        oldGroupQuery = oldGroupQuery.eq("attribute_combo", row.attribute_combo);
      }
      const { data: successor } = await oldGroupQuery;
      if (successor && successor.length > 0) {
        await admin
          .from("product_images")
          .update({ is_cover: true })
          .eq("id", (successor[0] as { id: string }).id);
      }
      // This image is no longer cover of its old group; flag false so
      // re-cover happens via new-group logic below.
      patch.is_cover = false;
    }

    // Compute the new display_order at the end of the new group, and
    // decide is_cover (true if the new group is empty pre-move).
    let newGroupQuery = admin
      .from("product_images")
      .select("id, display_order")
      .eq("product_id", row.product_id)
      .neq("id", row.id);
    if (newCombo === null) {
      newGroupQuery = newGroupQuery.is("attribute_combo", null);
    } else {
      newGroupQuery = newGroupQuery.eq("attribute_combo", newCombo);
    }
    const { data: newGroup } = await newGroupQuery;
    const newGroupRows = (newGroup ?? []) as Array<{ display_order: number }>;
    const maxOrder = newGroupRows.reduce(
      (m, r) => Math.max(m, Number(r.display_order)),
      -1
    );
    patch.display_order = maxOrder + 1;
    if (newGroupRows.length === 0) {
      patch.is_cover = true;
    }
  }

  if (Object.keys(patch).length === 0) {
    return fail<ProductImage>("No fields to update", "NO_OP");
  }

  const { data: updated, error: updErr } = await admin
    .from("product_images")
    .update(patch)
    .eq("id", row.id)
    .select()
    .single();
  if (updErr || !updated) {
    return fail<ProductImage>(updErr?.message ?? "Update failed", updErr?.code);
  }

  revalidatePath("/admin/products");
  revalidatePath("/products");

  return ok(updated as unknown as ProductImage);
}
