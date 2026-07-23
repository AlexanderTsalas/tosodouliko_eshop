"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { Attribute } from "@/types/attribute-facets";

const Schema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(100).optional(),
  type: z.enum(["select", "color", "size", "text"]).optional(),
  affectsPrice: z.boolean().optional(),
  splitsListing: z.boolean().optional(),
});

export async function updateAttribute(
  input: z.input<typeof Schema>
): Promise<Result<Attribute>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<Attribute>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:attributes"))) {
    return fail<Attribute>("Forbidden", "FORBIDDEN");
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.slug !== undefined) update.slug = parsed.data.slug;
  if (parsed.data.type !== undefined) update.type = parsed.data.type;
  if (parsed.data.affectsPrice !== undefined) update.affects_price = parsed.data.affectsPrice;
  if (parsed.data.splitsListing !== undefined) update.splits_listing = parsed.data.splitsListing;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("attributes")
    .update(update)
    .eq("id", parsed.data.id)
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") return fail<Attribute>("Slug already exists", "DUPLICATE_SLUG");
    return fail<Attribute>(error?.message ?? "Update failed", error?.code);
  }
  revalidatePath("/admin/attributes");
  updateTag("catalog-facets");
  return ok(data as unknown as Attribute);
}
