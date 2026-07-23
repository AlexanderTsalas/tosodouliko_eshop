"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ productId: z.string().uuid() });

/**
 * For a product with `default_supplier_id` set, creates supplier_products
 * rows linking that supplier to every variant of the product that does NOT
 * already have any supplier_products row. Variants already linked to any
 * supplier (including a different one) are left untouched.
 *
 * The first variant per product to be linked becomes the preferred one for
 * its row, so the supplier_products partial-unique-on-preferred index is
 * satisfied without extra coordination.
 *
 * Returns the number of links created.
 */
export async function applyDefaultSupplierToVariants(
  input: z.input<typeof Schema>
): Promise<Result<{ linked: number }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<{ linked: number }>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:suppliers"))) {
    return fail<{ linked: number }>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  // 1. Resolve the product's default supplier.
  const { data: product } = await supabase
    .from("products")
    .select("id, default_supplier_id")
    .eq("id", parsed.data.productId)
    .maybeSingle();
  if (!product) return fail<{ linked: number }>("Product not found", "NOT_FOUND");
  const supplierId = (product as { default_supplier_id: string | null }).default_supplier_id;
  if (!supplierId) {
    return fail<{ linked: number }>(
      "Product has no default supplier set.",
      "NO_DEFAULT"
    );
  }

  // 2. Find variants without any supplier_products row.
  const { data: variantsRaw } = await supabase
    .from("product_variants")
    .select("id, supplier_products(id)")
    .eq("product_id", parsed.data.productId);

  type Row = { id: string; supplier_products: { id: string }[] | null };
  const variants = (variantsRaw ?? []) as Row[];
  const unassigned = variants.filter((v) => !v.supplier_products || v.supplier_products.length === 0);

  if (unassigned.length === 0) {
    return ok({ linked: 0 });
  }

  // 3. Insert one supplier_products row per unassigned variant. First insert
  //    per variant is preferred automatically.
  const rows = unassigned.map((v) => ({
    variant_id: v.id,
    supplier_id: supplierId,
    is_preferred: true,
  }));

  const { error } = await supabase.from("supplier_products").insert(rows);
  if (error) {
    return fail<{ linked: number }>(error.message, error.code);
  }

  if (authData.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "supplier_product.bulk_linked",
      resource_type: "product",
      resource_id: parsed.data.productId,
      metadata: { supplier_id: supplierId, count: unassigned.length },
    });
  }

  revalidatePath("/admin/products");
  return ok({ linked: unassigned.length });
}
