"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { AttributeValue } from "@/types/attribute-facets";

const Schema = z.object({
  id: z.string().uuid(),
  value: z.string().min(1).max(200).optional(),
  displayOrder: z.number().int().nonnegative().optional(),
  priceModifier: z.number().optional(),
});

export async function updateAttributeValue(
  input: z.input<typeof Schema>
): Promise<Result<AttributeValue>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<AttributeValue>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:attributes"))) {
    return fail<AttributeValue>("Forbidden", "FORBIDDEN");
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.value !== undefined) update.value = parsed.data.value;
  if (parsed.data.displayOrder !== undefined) update.display_order = parsed.data.displayOrder;
  if (parsed.data.priceModifier !== undefined) update.price_modifier = parsed.data.priceModifier;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("attribute_values")
    .update(update)
    .eq("id", parsed.data.id)
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") return fail<AttributeValue>("Value already exists for this attribute", "DUPLICATE");
    return fail<AttributeValue>(error?.message ?? "Update failed", error?.code);
  }
  revalidatePath("/admin/attributes");
  updateTag("catalog-facets");
  return ok(data as unknown as AttributeValue);
}
