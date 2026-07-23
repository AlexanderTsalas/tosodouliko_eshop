"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { slugify } from "@/lib/slugify";
import { fail, ok, concurrentEdit, type Result } from "@/types/result";
import type { Product } from "@/types/products";

/**
 * Pick a slug derived from `base` that isn't already taken (excluding the
 * row being updated). Drafts share the default name "Νέο προϊόν", so the
 * derived slug collides constantly — append -2/-3/… on conflict.
 */
async function uniqueSlug(
  supabase: Awaited<ReturnType<typeof createClient>>,
  base: string,
  excludeId: string
): Promise<string> {
  const { data } = await supabase
    .from("products")
    .select("slug")
    .like("slug", `${base}%`)
    .neq("id", excludeId);
  const taken = new Set(
    ((data ?? []) as Array<{ slug: string }>).map((r) => r.slug)
  );
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

const Schema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  slug: z.string().min(1).max(200).optional(),
  description: z.string().max(20000).nullable().optional(),
  basePrice: z.number().nonnegative().optional(),
  currency: z.string().min(3).max(3).optional(),
  weightG: z.number().int().nonnegative().nullable().optional(),
  /** Outer package dimensions in mm. Each must be > 0 when set (DB CHECK). */
  lengthMm: z.number().int().positive().nullable().optional(),
  widthMm: z.number().int().positive().nullable().optional(),
  heightMm: z.number().int().positive().nullable().optional(),
  /** FK to volumetric_prefixes — categorical size class. Independent of raw L/W/H. */
  volumetricPrefixId: z.string().uuid().nullable().optional(),
  ageMin: z.number().int().min(0).max(99).nullable().optional(),
  ageMax: z.number().int().min(0).max(99).nullable().optional(),
  brand: z.string().max(200).nullable().optional(),
  active: z.boolean().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  splitOverrides: z.record(z.boolean()).nullable().optional(),
  vatRateId: z.string().uuid().nullable().optional(),
  costPrice: z.number().nonnegative().nullable().optional(),
  costCurrency: z.string().min(3).max(3).nullable().optional(),
  defaultSupplierId: z.string().uuid().nullable().optional(),
  /** Tri-state OOS visibility override. null = inherit from global. */
  showWhenOos: z.boolean().nullable().optional(),
  /** SKU prefix for variant SKU auto-generation. null clears the override
   *  (variants fall back to slugified product slug). */
  baseSku: z.string().max(80).nullable().optional(),
  /** Optimistic-lock guard from the page that rendered the form. */
  expected_updated_at: z.string().optional(),
});

export async function updateProduct(
  input: z.input<typeof Schema>
): Promise<Result<Product>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<Product>("Invalid input: " + parsed.error.issues[0].message, "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<Product>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<Product>("Not authenticated", "UNAUTHENTICATED");

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.slug !== undefined) update.slug = parsed.data.slug;
  if (parsed.data.description !== undefined) update.description = parsed.data.description;
  if (parsed.data.basePrice !== undefined) update.base_price = parsed.data.basePrice;
  if (parsed.data.currency !== undefined) update.currency = parsed.data.currency;
  if (parsed.data.weightG !== undefined) update.weight_g = parsed.data.weightG;
  if (parsed.data.lengthMm !== undefined) update.length_mm = parsed.data.lengthMm;
  if (parsed.data.widthMm !== undefined) update.width_mm = parsed.data.widthMm;
  if (parsed.data.heightMm !== undefined) update.height_mm = parsed.data.heightMm;
  if (parsed.data.volumetricPrefixId !== undefined)
    update.volumetric_prefix_id = parsed.data.volumetricPrefixId;
  if (parsed.data.ageMin !== undefined) update.age_min = parsed.data.ageMin;
  if (parsed.data.ageMax !== undefined) update.age_max = parsed.data.ageMax;
  if (parsed.data.brand !== undefined) update.brand = parsed.data.brand;
  if (parsed.data.active !== undefined) update.active = parsed.data.active;
  if (parsed.data.metadata !== undefined) update.metadata = parsed.data.metadata;
  if (parsed.data.splitOverrides !== undefined) {
    // Empty map ⇒ no overrides ⇒ store NULL so absence is uniform.
    const so = parsed.data.splitOverrides;
    update.split_overrides = so && Object.keys(so).length > 0 ? so : null;
  }
  if (parsed.data.vatRateId !== undefined) update.vat_rate_id = parsed.data.vatRateId;
  if (parsed.data.costPrice !== undefined) update.cost_price = parsed.data.costPrice;
  if (parsed.data.costCurrency !== undefined) {
    update.cost_currency = parsed.data.costCurrency
      ? parsed.data.costCurrency.toUpperCase()
      : null;
  }
  if (parsed.data.defaultSupplierId !== undefined) {
    update.default_supplier_id = parsed.data.defaultSupplierId;
  }
  if (parsed.data.showWhenOos !== undefined) {
    update.show_when_oos = parsed.data.showWhenOos;
  }
  if (parsed.data.baseSku !== undefined) {
    update.base_sku = parsed.data.baseSku ? parsed.data.baseSku.trim() : null;
  }

  // Keep a draft's slug following its name. When the name changes and no
  // slug was passed (e.g. the inline name edit on the products table), and
  // the current slug is still the auto-generated "draft-…" placeholder,
  // derive a fresh unique slug from the name. Once a real slug exists it's
  // left untouched (renaming a live product must not break its URL).
  if (parsed.data.name !== undefined && parsed.data.slug === undefined) {
    const { data: cur } = await supabase
      .from("products")
      .select("slug")
      .eq("id", parsed.data.id)
      .maybeSingle();
    const curSlug = (cur as { slug: string } | null)?.slug ?? "";
    if (curSlug.startsWith("draft-")) {
      update.slug = await uniqueSlug(
        supabase,
        slugify(parsed.data.name) || "draft",
        parsed.data.id
      );
    }
  }

  // Optimistic-lock UPDATE. .maybeSingle() so "no rows matched"
  // becomes data=null without throwing — we then distinguish "row
  // gone" (NOT_FOUND) from "predicate failed" (CONCURRENT_EDIT)
  // based on whether the caller asked for the guard.
  let updateQuery = supabase
    .from("products")
    .update(update)
    .eq("id", parsed.data.id);
  if (parsed.data.expected_updated_at) {
    updateQuery = updateQuery.eq("updated_at", parsed.data.expected_updated_at);
  }
  const { data, error } = await updateQuery.select().maybeSingle();

  if (error) {
    if (error.code === "23505") return fail<Product>("Slug already in use", "DUPLICATE_SLUG");
    return fail<Product>(error.message, error.code);
  }
  if (!data) {
    if (parsed.data.expected_updated_at) {
      return concurrentEdit<Product>();
    }
    return fail<Product>("Product not found", "NOT_FOUND");
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "product.updated",
    resource_type: "product",
    resource_id: parsed.data.id,
    metadata: { fields: Object.keys(update) },
  });

  revalidatePath("/admin/products");
  revalidatePath("/admin/products");
  if ((data as any).slug) revalidatePath(`/products/${(data as any).slug}`);
  revalidatePath("/sitemap.xml");
  revalidatePath("/products");
  updateTag("catalog-facets");
  return ok(data as unknown as Product);
}
