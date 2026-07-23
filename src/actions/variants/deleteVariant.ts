"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ id: z.string().uuid() });

/**
 * Deletes a single variant. Enforces the "every product has at least one
 * variant" invariant at the application layer — refuses to delete the variant
 * if it's the last one for its product.
 *
 * This used to be enforced by a DB trigger as well, but the trigger fired on
 * cascade deletes (when the parent product was being deleted), blocking
 * legitimate product deletion. App-level enforcement is sufficient because
 * the product create form requires variants up-front and the variants editor
 * is the only UI path that calls this action.
 */
export async function deleteVariant(
  input: z.input<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:products"))) {
    return fail<null>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();

  // Look up the variant's product so we can (a) refuse if it's the last one
  // and (b) revalidate the right paths afterward.
  const { data: existing } = await supabase
    .from("product_variants")
    .select("product_id")
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (!existing) {
    return fail<null>("Variant not found", "NOT_FOUND");
  }

  const productId = (existing as { product_id: string }).product_id;

  // Refuse if this is the last remaining variant of the product.
  const { count } = await supabase
    .from("product_variants")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);

  if (count !== null && count <= 1) {
    return fail<null>(
      "Δεν μπορείτε να διαγράψετε την τελευταία παραλλαγή. Διαγράψτε ολόκληρο το προϊόν αντί αυτού.",
      "LAST_VARIANT"
    );
  }

  const { error } = await supabase
    .from("product_variants")
    .delete()
    .eq("id", parsed.data.id);

  if (error) return fail<null>(error.message, error.code);

  revalidatePath("/admin/products");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/products");
  revalidatePath("/sitemap.xml");
  revalidatePath("/products");
  // Removing a variant removes a facet value option + shrinks the
  // catalog. Bust filtered URLs via the tag.
  updateTag("catalog-facets");
  return ok(null);
}
