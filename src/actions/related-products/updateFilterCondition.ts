"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { RelatedProductsFilterCondition } from "@/types/related-products";

const Schema = z.object({
  id: z.string().uuid(),
  /** Full config replacement — the editor sends the new shape inline.
   *  The action does not deep-merge with the existing config. */
  config: z.record(z.string(), z.unknown()).optional(),
  negate: z.boolean().optional(),
  sort_order: z.number().int().nonnegative().optional(),
});

/**
 * Updates a condition's config / negate / sort. The condition's `kind`
 * is immutable — to change kind, delete + create a new condition.
 * This keeps the polymorphic config validation honest (the create
 * action's per-kind schemas wouldn't apply on an update).
 */
export async function updateFilterCondition(
  input: z.input<typeof Schema>
): Promise<Result<RelatedProductsFilterCondition>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<RelatedProductsFilterCondition>(
      "Invalid input",
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<RelatedProductsFilterCondition>(
      "Forbidden",
      "FORBIDDEN"
    );
  }

  const admin = createAdminClient();
  const patch: Record<string, unknown> = {};
  if (parsed.data.config !== undefined) patch.config = parsed.data.config;
  if (parsed.data.negate !== undefined) patch.negate = parsed.data.negate;
  if (parsed.data.sort_order !== undefined)
    patch.sort_order = parsed.data.sort_order;

  if (Object.keys(patch).length === 0) {
    return fail<RelatedProductsFilterCondition>(
      "No fields to update",
      "NO_CHANGES"
    );
  }

  const { data: row, error } = await admin
    .from("related_products_filter_conditions")
    .update(patch)
    .eq("id", parsed.data.id)
    .select()
    .single();

  if (error || !row) {
    return fail<RelatedProductsFilterCondition>(
      "Failed to update condition: " + error?.message,
      error?.code
    );
  }

  revalidatePath("/admin/related-products");
  return ok(row as RelatedProductsFilterCondition);
}
