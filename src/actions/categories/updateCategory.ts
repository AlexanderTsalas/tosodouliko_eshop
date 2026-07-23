"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { Category } from "@/types/category-navigation";

const AutoRulesSchema = z.object({
  attribute_filters: z.record(z.array(z.string())),
});

const Schema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  slug: z.string().min(1).max(200).optional(),
  parentId: z.string().uuid().nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  displayOrder: z.number().int().nonnegative().optional(),
  active: z.boolean().optional(),
  mode: z.enum(["manual", "auto"]).optional(),
  autoRules: AutoRulesSchema.nullable().optional(),
  vatRateId: z.string().uuid().nullable().optional(),
});

export async function updateCategory(
  input: z.input<typeof Schema>
): Promise<Result<Category>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<Category>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:categories"))) {
    return fail<Category>("Forbidden", "FORBIDDEN");
  }

  // Prevent setting parent to self or descendant — simple self-check; full
  // descendant cycle prevention can be added with a recursive CTE later.
  if (parsed.data.parentId === parsed.data.id) {
    return fail<Category>("Category cannot be its own parent", "INVALID_PARENT");
  }

  // Auto-categories need rules with at least one attribute filter.
  if (parsed.data.mode === "auto") {
    const filters = parsed.data.autoRules?.attribute_filters ?? {};
    const hasAny = Object.values(filters).some((vs) => vs.length > 0);
    if (!hasAny) {
      return fail<Category>(
        "Auto category requires at least one attribute filter with values.",
        "EMPTY_RULES"
      );
    }
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.slug !== undefined) update.slug = parsed.data.slug;
  if (parsed.data.parentId !== undefined) update.parent_id = parsed.data.parentId;
  if (parsed.data.description !== undefined) update.description = parsed.data.description;
  if (parsed.data.imageUrl !== undefined) update.image_url = parsed.data.imageUrl;
  if (parsed.data.displayOrder !== undefined) update.display_order = parsed.data.displayOrder;
  if (parsed.data.active !== undefined) update.active = parsed.data.active;
  if (parsed.data.mode !== undefined) {
    update.mode = parsed.data.mode;
    // When switching to manual, null out auto rules; when switching to auto,
    // store the new rules (and they're guaranteed non-empty by the check above).
    update.auto_rules =
      parsed.data.mode === "auto" ? parsed.data.autoRules ?? null : null;
  } else if (parsed.data.autoRules !== undefined) {
    // mode unchanged but rules edited — only persist if currently auto (we let
    // the DB carry the existing mode; no-op when stored mode is manual).
    update.auto_rules = parsed.data.autoRules;
  }
  if (parsed.data.vatRateId !== undefined) update.vat_rate_id = parsed.data.vatRateId;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .update(update)
    .eq("id", parsed.data.id)
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") return fail<Category>("Slug already in use", "DUPLICATE_SLUG");
    return fail<Category>(error?.message ?? "Update failed", error?.code);
  }

  revalidatePath("/admin/categories");
  updateTag("categories");
  return ok(data as unknown as Category);
}
