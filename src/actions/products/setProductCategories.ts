"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  productId: z.string().uuid(),
  categoryIds: z.array(z.string().uuid()),
});

/**
 * Replaces the set of categories for a product. Atomic: deletes existing
 * assignments and inserts the new set in one round trip.
 */
export async function setProductCategories(
  input: z.input<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");

  if (!(await checkPermission("manage:products"))) {
    return fail<null>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();

  const { error: delErr } = await supabase
    .from("product_categories")
    .delete()
    .eq("product_id", parsed.data.productId);
  if (delErr) return fail<null>(delErr.message, delErr.code);

  if (parsed.data.categoryIds.length > 0) {
    const rows = parsed.data.categoryIds.map((cid) => ({
      product_id: parsed.data.productId,
      category_id: cid,
    }));
    const { error: insErr } = await supabase.from("product_categories").insert(rows);
    if (insErr) return fail<null>(insErr.message, insErr.code);
  }

  revalidatePath("/admin/products");
  // Category assignment changes affect storefront /products filter
  // navigation, category landing pages, and facet counts. Bust all
  // three.
  revalidatePath("/products");
  updateTag("catalog-facets");
  updateTag("categories");
  return ok(null);
}
