"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { resolveProductImageUrls } from "@/lib/media/resolveProductImageUrl";
import { fail, ok, type Result } from "@/types/result";
import type { ProductImage } from "@/types/products";

const Schema = z.object({
  productId: z.string().uuid(),
  mediaAssetIds: z.array(z.string().uuid()).min(1),
  attributeCombo: z.record(z.string(), z.string()).default({}),
});

/**
 * Bulk-link existing media_assets to a product as new product_images
 * rows tagged with the given attribute_combo. Used by the media
 * library picker in the Images tab — admin browses the library,
 * multi-selects existing assets, applies them to the current
 * attribute-combo group.
 *
 * Behavior:
 *   - Each media_asset becomes one product_images row pointing back
 *     at it (multiple product_images CAN reference the same
 *     media_asset, including in the same product but different combo)
 *   - Auto alt-text generated per row from product.name + combo labels
 *   - Display_order appends to the end of the current group
 *   - First link makes the new image the cover IF the group was empty
 *
 * Returns the created product_images rows.
 */
export async function linkMediaAssetsToProduct(
  input: z.input<typeof Schema>
): Promise<Result<ProductImage[]>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<ProductImage[]>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<ProductImage[]>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();

  // Load the product (for alt-text generation).
  const { data: productRow } = await admin
    .from("products")
    .select("id, name, slug")
    .eq("id", parsed.data.productId)
    .maybeSingle();
  if (!productRow) {
    return fail<ProductImage[]>("Product not found", "PRODUCT_NOT_FOUND");
  }
  const product = productRow as { id: string; name: string; slug: string };

  // Load the media_assets to verify existence + get bucket/key per
  // asset (for the legacy storage_key column copy).
  const { data: mediaRows, error: mediaErr } = await admin
    .from("media_assets")
    .select("id, bucket, storage_key, alt_text")
    .in("id", parsed.data.mediaAssetIds);
  if (mediaErr) {
    return fail<ProductImage[]>(mediaErr.message, mediaErr.code);
  }
  if (!mediaRows || mediaRows.length !== parsed.data.mediaAssetIds.length) {
    return fail<ProductImage[]>(
      "Some media assets not found",
      "MEDIA_NOT_FOUND"
    );
  }

  // Build auto alt-text once (same combo applies to all selected).
  const valueIds = Object.values(parsed.data.attributeCombo);
  let comboLabel = "";
  if (valueIds.length > 0) {
    const { data: vals } = await admin
      .from("attribute_values")
      .select("id, value")
      .in("id", valueIds);
    const labelById = new Map(
      ((vals ?? []) as Array<{ id: string; value: string }>).map((r) => [
        r.id,
        r.value,
      ])
    );
    const labels = valueIds
      .map((id) => labelById.get(id))
      .filter((v): v is string => Boolean(v));
    if (labels.length > 0) comboLabel = labels.join(" — ");
  }

  // Compute starting display_order at the end of the existing group.
  const insertCombo =
    Object.keys(parsed.data.attributeCombo).length === 0
      ? null
      : parsed.data.attributeCombo;
  let groupQuery = admin
    .from("product_images")
    .select("display_order, is_cover")
    .eq("product_id", parsed.data.productId);
  if (insertCombo === null) {
    groupQuery = groupQuery.is("attribute_combo", null);
  } else {
    groupQuery = groupQuery.eq("attribute_combo", insertCombo);
  }
  const { data: existing } = await groupQuery;
  const existingRows = (existing ?? []) as Array<{
    display_order: number;
    is_cover: boolean;
  }>;
  const maxOrder = existingRows.reduce(
    (m, r) => Math.max(m, Number(r.display_order)),
    -1
  );
  const groupHasCover = existingRows.some((r) => r.is_cover);

  // Build insert payloads. First inserted becomes cover IF no existing
  // cover in the group.
  const rows = (mediaRows as Array<{
    id: string;
    bucket: string;
    storage_key: string;
    alt_text: string | null;
  }>).map((ma, idx) => {
    const autoAlt = comboLabel
      ? `${product.name} — ${comboLabel}`
      : product.name;
    return {
      product_id: parsed.data.productId,
      media_asset_id: ma.id,
      bucket: ma.bucket,
      storage_key: ma.storage_key,
      url: null,
      attribute_combo: insertCombo,
      alt_text: ma.alt_text ?? autoAlt,
      alt_text_is_auto: ma.alt_text === null,
      display_order: maxOrder + 1 + idx,
      is_cover: !groupHasCover && idx === 0,
    };
  });

  const { data: inserted, error: insErr } = await admin
    .from("product_images")
    .insert(rows)
    .select();
  if (insErr || !inserted) {
    return fail<ProductImage[]>(
      insErr?.message ?? "Bulk insert failed",
      insErr?.code ?? "DB_ERROR"
    );
  }

  revalidatePath("/admin/products");
  revalidatePath(`/products/${product.slug}`);
  revalidatePath("/products");

  // Resolve URLs in parallel so client receives populated url fields.
  const resolved = await resolveProductImageUrls(
    inserted as unknown as ProductImage[]
  );
  return ok(resolved);
}
