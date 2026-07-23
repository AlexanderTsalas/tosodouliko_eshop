"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { RelatedProductsFilterGroup } from "@/types/related-products";

const Schema = z.object({
  association_id: z.string().uuid(),
  side: z.enum(["source", "target"]),
  /** When omitted, appends at the end (max(sort_order) + 1). */
  sort_order: z.number().int().nonnegative().optional(),
});

/**
 * Creates a new filter group on one side of an association. An empty
 * group is allowed at creation — it has no semantic effect until at
 * least one condition is added. The bench renders empty groups so the
 * user can populate them.
 */
export async function createFilterGroup(
  input: z.input<typeof Schema>
): Promise<Result<RelatedProductsFilterGroup>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<RelatedProductsFilterGroup>(
      "Invalid input",
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<RelatedProductsFilterGroup>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();
  let sortOrder = parsed.data.sort_order;
  if (sortOrder === undefined) {
    const { data: existing } = await admin
      .from("related_products_filter_groups")
      .select("sort_order")
      .eq("association_id", parsed.data.association_id)
      .eq("side", parsed.data.side)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    sortOrder = existing
      ? ((existing as { sort_order: number }).sort_order ?? 0) + 1
      : 0;
  }

  const { data: row, error } = await admin
    .from("related_products_filter_groups")
    .insert({
      association_id: parsed.data.association_id,
      side: parsed.data.side,
      sort_order: sortOrder,
    })
    .select()
    .single();

  if (error || !row) {
    return fail<RelatedProductsFilterGroup>(
      "Failed to create group: " + error?.message,
      error?.code
    );
  }

  revalidatePath("/admin/related-products");
  return ok(row as RelatedProductsFilterGroup);
}
