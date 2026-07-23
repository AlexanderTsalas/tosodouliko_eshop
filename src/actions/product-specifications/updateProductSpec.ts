"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { slugifyValue } from "@/lib/variants-helpers";
import { fail, ok, type Result } from "@/types/result";
import type { ProductSpecification } from "@/types/product-specifications";

const Schema = z.object({
  id: z.string().uuid(),
  value: z.string().min(1).max(500).optional(),
  displayOrder: z.number().int().nonnegative().optional(),
});

export async function updateProductSpec(
  input: z.input<typeof Schema>
): Promise<Result<ProductSpecification>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<ProductSpecification>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:products"))) {
    return fail<ProductSpecification>("Forbidden", "FORBIDDEN");
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.value !== undefined) update.value = parsed.data.value;
  if (parsed.data.displayOrder !== undefined) update.display_order = parsed.data.displayOrder;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_specifications")
    .update(update)
    .eq("id", parsed.data.id)
    .select()
    .single();

  if (error || !data) {
    return fail<ProductSpecification>(error?.message ?? "Update failed", error?.code);
  }
  const row = data as unknown as ProductSpecification;

  // Mirror the new value into attribute_values via race-safe upsert
  // (Phase 9 of the data-layer remediation). Concurrent admins
  // updating two specs to the same new value no longer collide on the
  // INSERT; .select() returns the inserted row (if any) so we know
  // whether to bust the catalog-facets tag.
  if (parsed.data.value !== undefined) {
    const valueSlug = slugifyValue(parsed.data.value) || "value";
    const { data: maxRow } = await supabase
      .from("attribute_values")
      .select("display_order")
      .eq("attribute_id", row.attribute_id)
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextOrder = maxRow
      ? Number((maxRow as { display_order: number }).display_order) + 1
      : 0;
    const { data: avData } = await supabase
      .from("attribute_values")
      .upsert(
        {
          attribute_id: row.attribute_id,
          value: parsed.data.value,
          slug: valueSlug,
          display_order: nextOrder,
        },
        { onConflict: "attribute_id,slug", ignoreDuplicates: true }
      )
      .select("id");
    if ((avData ?? []).length > 0) updateTag("catalog-facets");
  }

  revalidatePath("/admin/products");
  revalidatePath("/admin/attributes");
  revalidatePath("/products");
  return ok(row);
}
