"use server";

import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { slugify } from "@/lib/slugify";
import { fail, ok, type Result } from "@/types/result";
import type { Attribute } from "@/types/attribute-facets";

const Schema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).optional(),
  type: z.enum(["select", "color", "size", "text"]).default("select"),
});

export async function createAttribute(
  input: z.input<typeof Schema>
): Promise<Result<Attribute>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<Attribute>("Invalid input: " + parsed.error.issues[0].message, "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:attributes"))) {
    return fail<Attribute>("Forbidden", "FORBIDDEN");
  }

  const slug = parsed.data.slug ?? slugify(parsed.data.name);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("attributes")
    .insert({ name: parsed.data.name, slug, type: parsed.data.type ?? "select" })
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") return fail<Attribute>("Slug already exists", "DUPLICATE_SLUG");
    return fail<Attribute>(error?.message ?? "Insert failed", error?.code);
  }
  revalidatePath("/admin/attributes");
  updateTag("catalog-facets");
  return ok(data as unknown as Attribute);
}
