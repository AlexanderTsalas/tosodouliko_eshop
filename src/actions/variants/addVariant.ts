"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { ProductVariant } from "@/types/product-variants";

const Schema = z.object({
  productId: z.string().uuid(),
  sku: z.string().min(1).max(100),
  price: z.number().nonnegative(),
  /**
   * Map of attribute_slug → attribute_value_id (uuid). The DB trigger
   * `validate_attribute_combo` enforces that every uuid points at a real
   * attribute_values row under the matching attribute.
   */
  attributeCombo: z.record(z.string().uuid()).optional(),
  isActive: z.boolean().default(true),
});

export async function addVariant(
  input: z.input<typeof Schema>
): Promise<Result<ProductVariant>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<ProductVariant>("Invalid input: " + parsed.error.issues[0].message, "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<ProductVariant>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_variants")
    .insert({
      product_id: parsed.data.productId,
      sku: parsed.data.sku,
      price: parsed.data.price,
      attribute_combo: parsed.data.attributeCombo ?? null,
      is_active: parsed.data.isActive ?? true,
    })
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") return fail<ProductVariant>("SKU or attribute combo already exists", "DUPLICATE");
    return fail<ProductVariant>(error?.message ?? "Insert failed", error?.code);
  }

  // If the parent product has a default supplier set, auto-link this new
  // variant to it as the preferred supplier. Non-fatal: a failure here
  // leaves the variant alive; admin can link manually from the variant tab.
  const newVariant = data as { id: string };
  const { data: parent } = await supabase
    .from("products")
    .select("default_supplier_id")
    .eq("id", parsed.data.productId)
    .maybeSingle();
  const defaultSupplierId = (parent as { default_supplier_id: string | null } | null)?.default_supplier_id;
  if (defaultSupplierId) {
    await supabase.from("supplier_products").insert({
      variant_id: newVariant.id,
      supplier_id: defaultSupplierId,
      is_preferred: true,
    });
  }

  // The on_variant_inventory_change trigger auto-creates an inventory_items row.
  revalidatePath("/admin/products");
  // New variants change catalog facet sets (a new color/size becomes
  // available) and the storefront product list. Bust both.
  revalidatePath("/products");
  updateTag("catalog-facets");
  return ok(data as unknown as ProductVariant);
}
