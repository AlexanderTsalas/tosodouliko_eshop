"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { RelatedProductsFilterCondition } from "@/types/related-products";

// Per-kind config schemas — Zod refinement keeps the polymorphic
// `config` jsonb honest at the action layer. The DB enforces only the
// `kind` enum + jsonb-typeof check.
const CategoryConfig = z.object({
  category_id: z.string().uuid(),
  include_descendants: z.boolean().default(true),
});
const ProductConfig = z.object({ product_id: z.string().uuid() });
const VariantConfig = z.object({ variant_id: z.string().uuid() });
const AttributeValueConfig = z.object({
  attribute_id: z.string().uuid(),
  value: z.string().min(1).max(200),
});
const AttributeValueInConfig = z.object({
  attribute_id: z.string().uuid(),
  values: z.array(z.string().min(1).max(200)).min(1),
});
const AttributePresentConfig = z.object({
  attribute_id: z.string().uuid(),
});
const TagConfig = z.object({ tag: z.string().min(1).max(100) });

const Schema = z.discriminatedUnion("kind", [
  z.object({
    filter_group_id: z.string().uuid(),
    negate: z.boolean().default(false),
    sort_order: z.number().int().nonnegative().optional(),
    kind: z.literal("category"),
    config: CategoryConfig,
  }),
  z.object({
    filter_group_id: z.string().uuid(),
    negate: z.boolean().default(false),
    sort_order: z.number().int().nonnegative().optional(),
    kind: z.literal("product"),
    config: ProductConfig,
  }),
  z.object({
    filter_group_id: z.string().uuid(),
    negate: z.boolean().default(false),
    sort_order: z.number().int().nonnegative().optional(),
    kind: z.literal("variant"),
    config: VariantConfig,
  }),
  z.object({
    filter_group_id: z.string().uuid(),
    negate: z.boolean().default(false),
    sort_order: z.number().int().nonnegative().optional(),
    kind: z.literal("attribute_value"),
    config: AttributeValueConfig,
  }),
  z.object({
    filter_group_id: z.string().uuid(),
    negate: z.boolean().default(false),
    sort_order: z.number().int().nonnegative().optional(),
    kind: z.literal("attribute_value_in"),
    config: AttributeValueInConfig,
  }),
  z.object({
    filter_group_id: z.string().uuid(),
    negate: z.boolean().default(false),
    sort_order: z.number().int().nonnegative().optional(),
    kind: z.literal("attribute_present"),
    config: AttributePresentConfig,
  }),
  z.object({
    filter_group_id: z.string().uuid(),
    negate: z.boolean().default(false),
    sort_order: z.number().int().nonnegative().optional(),
    kind: z.literal("tag"),
    config: TagConfig,
  }),
]);

export async function createFilterCondition(
  input: z.input<typeof Schema>
): Promise<Result<RelatedProductsFilterCondition>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<RelatedProductsFilterCondition>(
      "Invalid input: " + parsed.error.issues[0]?.message,
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
  let sortOrder = parsed.data.sort_order;
  if (sortOrder === undefined) {
    const { data: existing } = await admin
      .from("related_products_filter_conditions")
      .select("sort_order")
      .eq("filter_group_id", parsed.data.filter_group_id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    sortOrder = existing
      ? ((existing as { sort_order: number }).sort_order ?? 0) + 1
      : 0;
  }

  const { data: row, error } = await admin
    .from("related_products_filter_conditions")
    .insert({
      filter_group_id: parsed.data.filter_group_id,
      kind: parsed.data.kind,
      config: parsed.data.config,
      negate: parsed.data.negate,
      sort_order: sortOrder,
    })
    .select()
    .single();

  if (error || !row) {
    return fail<RelatedProductsFilterCondition>(
      "Failed to create condition: " + error?.message,
      error?.code
    );
  }

  revalidatePath("/admin/related-products");
  return ok(row as RelatedProductsFilterCondition);
}
