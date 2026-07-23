"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { RelatedProductsAssociation } from "@/types/related-products";

const Schema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  message_title_translations: z
    .record(z.string(), z.string().max(200))
    .optional(),
  active: z.boolean().optional(),
  display_order: z.number().int().min(1).optional(),
  bidirectional: z.boolean().optional(),
  exclude_oos: z.boolean().optional(),
  selection_strategy: z
    .enum(["random", "recent", "manual"])
    .optional(),
  max_results: z.number().int().min(1).max(24).optional(),
  card_granularity: z.enum(["product", "variant"]).optional(),
});

export async function updateRelatedProductsAssociation(
  input: z.input<typeof Schema>
): Promise<Result<RelatedProductsAssociation>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<RelatedProductsAssociation>(
      "Invalid input",
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<RelatedProductsAssociation>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();
  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.message_title_translations !== undefined)
    patch.message_title_translations = parsed.data.message_title_translations;
  if (parsed.data.active !== undefined) patch.active = parsed.data.active;
  if (parsed.data.display_order !== undefined)
    patch.display_order = parsed.data.display_order;
  if (parsed.data.bidirectional !== undefined)
    patch.bidirectional = parsed.data.bidirectional;
  if (parsed.data.exclude_oos !== undefined)
    patch.exclude_oos = parsed.data.exclude_oos;
  if (parsed.data.selection_strategy !== undefined)
    patch.selection_strategy = parsed.data.selection_strategy;
  if (parsed.data.max_results !== undefined)
    patch.max_results = parsed.data.max_results;
  if (parsed.data.card_granularity !== undefined)
    patch.card_granularity = parsed.data.card_granularity;

  if (Object.keys(patch).length === 0) {
    return fail<RelatedProductsAssociation>(
      "No fields to update",
      "NO_CHANGES"
    );
  }

  const { data: row, error } = await admin
    .from("related_products_associations")
    .update(patch)
    .eq("id", parsed.data.id)
    .select()
    .single();

  if (error || !row) {
    return fail<RelatedProductsAssociation>(
      "Failed to update association: " + error?.message,
      error?.code
    );
  }

  revalidatePath("/admin/related-products");
  return ok(row as RelatedProductsAssociation);
}
