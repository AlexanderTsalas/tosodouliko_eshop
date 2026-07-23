"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { slugify } from "@/lib/slugify";
import { fail, ok, type Result } from "@/types/result";
import type { Category } from "@/types/category-navigation";

const AutoRulesSchema = z.object({
  attribute_filters: z.record(z.array(z.string())),
});

const Schema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(200).optional(),
  parentId: z.string().uuid().nullable().optional(),
  description: z.string().max(2000).optional(),
  imageUrl: z.string().url().optional(),
  displayOrder: z.number().int().nonnegative().default(0),
  active: z.boolean().default(true),
  mode: z.enum(["manual", "auto"]).default("manual"),
  autoRules: AutoRulesSchema.nullable().optional(),
  vatRateId: z.string().uuid().nullable().optional(),
});

export async function createCategory(
  input: z.input<typeof Schema>
): Promise<Result<Category>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<Category>("Invalid input: " + parsed.error.issues[0].message, "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:categories"))) {
    return fail<Category>("Forbidden", "FORBIDDEN");
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

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  const slug = parsed.data.slug ?? slugify(parsed.data.name);

  // Insert with the service-role client (RLS-bypassing) AFTER the explicit
  // permission check above — matches createProduct/createAttribute and
  // avoids any RLS-policy edge that would block a permitted admin.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("categories")
    .insert({
      parent_id: parsed.data.parentId ?? null,
      slug,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      image_url: parsed.data.imageUrl ?? null,
      display_order: parsed.data.displayOrder ?? 0,
      active: parsed.data.active ?? true,
      mode: parsed.data.mode ?? "manual",
      auto_rules: parsed.data.mode === "auto" ? parsed.data.autoRules ?? null : null,
      vat_rate_id: parsed.data.vatRateId ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") return fail<Category>("Slug already in use", "DUPLICATE_SLUG");
    return fail<Category>(error?.message ?? "Insert failed", error?.code);
  }

  if (authData.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "category.created",
      resource_type: "category",
      resource_id: (data as { id: string }).id,
      metadata: { name: parsed.data.name, slug, mode: parsed.data.mode },
    });
  }

  revalidatePath("/admin/categories");
  revalidatePath("/products");
  updateTag("categories");
  return ok(data as unknown as Category);
}
