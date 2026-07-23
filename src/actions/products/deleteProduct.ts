"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ id: z.string().uuid() });

/**
 * Hard-deletes a product. Cascades through FKs to product_images,
 * product_categories, product_variants, and inventory_items. Cart_items and
 * order_items reference the product but use SET NULL/CASCADE depending on
 * relationship — order history is preserved via the snapshotted name/sku columns.
 */
export async function deleteProduct(
  input: z.input<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");

  if (!(await checkPermission("manage:products"))) {
    return fail<null>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<null>("Not authenticated", "UNAUTHENTICATED");

  const { error } = await supabase.from("products").delete().eq("id", parsed.data.id);
  if (error) return fail<null>(error.message, error.code);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "product.deleted",
    resource_type: "product",
    resource_id: parsed.data.id,
  });

  revalidatePath("/admin/products");
  revalidatePath("/sitemap.xml");
  revalidatePath("/products");
  updateTag("catalog-facets");
  return ok(null);
}
