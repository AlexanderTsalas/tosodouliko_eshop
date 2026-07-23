"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  productId: z.string().uuid(),
  /**
   * Attribute slugs that drive image selection on this product. Must
   * be a subset of the product's variant attributes. Empty array =
   * no axes drive imagery (all images apply to all variants).
   */
  imageAxes: z.array(z.string()).default([]),
});

/**
 * Sets `products.image_axes` — declares which attribute axes drive
 * image selection.
 *
 * The change is non-destructive: existing product_images keep their
 * attribute_combo unchanged. The Images-tab UI surfaces an
 * informational notice that re-tagging may be desirable but isn't
 * required.
 *
 * Validation: every axis in `imageAxes` must appear in at least one
 * existing variant of this product. This catches the case where admin
 * picks "size" but the product doesn't actually have size variants
 * (typo or stale state from before variants were renamed).
 */
export async function setProductImageAxes(
  input: z.input<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:products"))) {
    return fail<null>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();

  if (parsed.data.imageAxes.length > 0) {
    // Validate that every axis appears in at least one variant.
    const { data: variants } = await admin
      .from("product_variants")
      .select("attribute_combo")
      .eq("product_id", parsed.data.productId);
    const knownAxes = new Set<string>();
    for (const v of (variants ?? []) as Array<{
      attribute_combo: Record<string, string> | null;
    }>) {
      if (!v.attribute_combo) continue;
      for (const k of Object.keys(v.attribute_combo)) knownAxes.add(k);
    }
    const invalid = parsed.data.imageAxes.filter((a) => !knownAxes.has(a));
    if (invalid.length > 0) {
      return fail<null>(
        `Invalid axes for this product: ${invalid.join(", ")}`,
        "INVALID_AXES"
      );
    }
  }

  const { error: updErr } = await admin
    .from("products")
    .update({ image_axes: parsed.data.imageAxes })
    .eq("id", parsed.data.productId);
  if (updErr) return fail<null>(updErr.message, updErr.code);

  revalidatePath("/admin/products");
  revalidatePath("/products");

  return ok(null);
}
