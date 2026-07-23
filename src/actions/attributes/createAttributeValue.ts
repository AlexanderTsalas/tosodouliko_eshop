"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { slugifyValue } from "@/lib/variants-helpers";
import { fail, ok, type Result } from "@/types/result";
import type { AttributeValue } from "@/types/attribute-facets";

const Schema = z.object({
  attributeId: z.string().uuid(),
  value: z.string().min(1).max(200),
  /**
   * URL slug. If omitted, derived from `value` via the Greek-aware
   * slugifier. Admin can override at creation time; after save the slug
   * is read-only in the UI (no rename-with-redirect mechanism yet).
   */
  slug: z.string().min(1).max(200).optional(),
  displayOrder: z.number().int().nonnegative().optional(),
});

export async function createAttributeValue(
  input: z.input<typeof Schema>
): Promise<Result<AttributeValue>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<AttributeValue>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:attributes"))) {
    return fail<AttributeValue>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();

  let displayOrder = parsed.data.displayOrder;
  if (displayOrder === undefined) {
    const { data: max } = await admin
      .from("attribute_values")
      .select("display_order")
      .eq("attribute_id", parsed.data.attributeId)
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    displayOrder = max ? Number((max as any).display_order) + 1 : 0;
  }

  // Derive slug from display value if the admin didn't supply one. If the
  // derived slug collides with another value under the same attribute,
  // append a numeric suffix.
  const desiredSlug = (parsed.data.slug ?? slugifyValue(parsed.data.value)) || "value";
  let finalSlug = desiredSlug;
  for (let suffix = 2; suffix < 100; suffix++) {
    const { data: existing } = await admin
      .from("attribute_values")
      .select("id")
      .eq("attribute_id", parsed.data.attributeId)
      .eq("slug", finalSlug)
      .maybeSingle();
    if (!existing) break;
    finalSlug = `${desiredSlug}-${suffix}`;
  }

  const { data, error } = await admin
    .from("attribute_values")
    .insert({
      attribute_id: parsed.data.attributeId,
      value: parsed.data.value,
      slug: finalSlug,
      display_order: displayOrder,
    })
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") return fail<AttributeValue>("Value already exists for this attribute", "DUPLICATE");
    return fail<AttributeValue>(error?.message ?? "Insert failed", error?.code);
  }
  revalidatePath("/admin/attributes");
  updateTag("catalog-facets");
  return ok(data as unknown as AttributeValue);
}
