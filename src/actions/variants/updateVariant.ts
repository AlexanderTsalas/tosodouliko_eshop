"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, concurrentEdit, type Result } from "@/types/result";
import type { ProductVariant } from "@/types/product-variants";

const Schema = z.object({
  id: z.string().uuid(),
  sku: z.string().min(1).max(100).optional(),
  price: z.number().nonnegative().optional(),
  attributeCombo: z.record(z.string().uuid()).nullable().optional(),
  isActive: z.boolean().optional(),
  trackSupply: z.boolean().optional(),
  /** Tri-state OOS visibility override. null = inherit from product/global. */
  showWhenOos: z.boolean().nullable().optional(),
  /** Optimistic-lock guard from the page that rendered this form.
   *  Optional — programmatic callers (bulk operations, admin scripts)
   *  can omit it to keep the legacy unconditional write. */
  expected_updated_at: z.string().optional(),
});

export async function updateVariant(
  input: z.input<typeof Schema>
): Promise<Result<ProductVariant>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<ProductVariant>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<ProductVariant>("Forbidden", "FORBIDDEN");
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.sku !== undefined) update.sku = parsed.data.sku;
  if (parsed.data.price !== undefined) update.price = parsed.data.price;
  if (parsed.data.attributeCombo !== undefined) update.attribute_combo = parsed.data.attributeCombo;
  if (parsed.data.isActive !== undefined) update.is_active = parsed.data.isActive;
  if (parsed.data.trackSupply !== undefined) update.track_supply = parsed.data.trackSupply;
  if (parsed.data.showWhenOos !== undefined) update.show_when_oos = parsed.data.showWhenOos;

  const supabase = await createClient();
  let updateQuery = supabase
    .from("product_variants")
    .update(update)
    .eq("id", parsed.data.id);
  if (parsed.data.expected_updated_at) {
    updateQuery = updateQuery.eq("updated_at", parsed.data.expected_updated_at);
  }
  const { data, error } = await updateQuery.select().maybeSingle();

  if (error) {
    if (error.code === "23505") return fail<ProductVariant>("SKU already exists", "DUPLICATE_SKU");
    return fail<ProductVariant>(error.message, error.code);
  }
  if (!data) {
    if (parsed.data.expected_updated_at) {
      return concurrentEdit<ProductVariant>();
    }
    return fail<ProductVariant>("Variant not found", "NOT_FOUND");
  }

  revalidatePath("/admin/products");
  revalidatePath("/sitemap.xml");
  revalidatePath("/products");
  // Price/SKU/active changes flip catalog content. Bust the tag so
  // filtered URLs invalidate, not just the base /products route.
  updateTag("catalog-facets");
  return ok(data as unknown as ProductVariant);
}
