"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ id: z.string().uuid() });

export async function deleteAttribute(
  input: z.input<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:attributes"))) {
    return fail<null>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();

  const { data: attr } = await admin
    .from("attributes")
    .select("slug")
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (attr?.slug) {
    // Refuse if any product_variants reference this attribute slug.
    const { count } = await admin
      .from("product_variants")
      .select("id", { count: "exact", head: true })
      .filter("attribute_combo", "cs", JSON.stringify({ [(attr as any).slug]: "" }).slice(0, -3) + "}");

    // The above filter is loose; do a more precise check:
    const { data: usedRows } = await admin
      .from("product_variants")
      .select("id, attribute_combo")
      .not("attribute_combo", "is", null);

    const used = (usedRows ?? []).some((r: any) => {
      const combo = r.attribute_combo;
      return combo && Object.prototype.hasOwnProperty.call(combo, (attr as any).slug);
    });

    if (used) {
      return fail<null>(
        `Cannot delete: at least one product variant uses this attribute. Remove it from variants first.`,
        "ATTRIBUTE_IN_USE"
      );
    }
  }

  const { error } = await admin.from("attributes").delete().eq("id", parsed.data.id);
  if (error) return fail<null>(error.message, error.code);

  revalidatePath("/admin/attributes");
  updateTag("catalog-facets");
  return ok(null);
}
