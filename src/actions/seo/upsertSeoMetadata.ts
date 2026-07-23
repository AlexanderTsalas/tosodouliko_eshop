"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { SeoMetadata } from "@/types/dynamic-seo";

const Schema = z.object({
  resourceType: z.string().min(1).max(100),
  resourceId: z.string().min(1).max(200),
  title: z.string().max(200).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  ogImageUrl: z.string().url().nullable().optional(),
  robots: z.string().max(100).nullable().optional(),
  canonicalUrl: z.string().url().nullable().optional(),
  noIndex: z.boolean().default(false),
});

export async function upsertSeoMetadata(
  input: z.input<typeof Schema>
): Promise<Result<SeoMetadata>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<SeoMetadata>("Invalid input: " + parsed.error.issues[0].message, "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:seo"))) {
    return fail<SeoMetadata>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("seo_metadata")
    .upsert(
      {
        resource_type: parsed.data.resourceType,
        resource_id: parsed.data.resourceId,
        title: parsed.data.title ?? null,
        description: parsed.data.description ?? null,
        og_image_url: parsed.data.ogImageUrl ?? null,
        robots: parsed.data.robots ?? "index,follow",
        canonical_url: parsed.data.canonicalUrl ?? null,
        no_index: parsed.data.noIndex ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "resource_type,resource_id" }
    )
    .select()
    .single();

  if (error || !data) return fail<SeoMetadata>(error?.message ?? "Upsert failed", error?.code);
  revalidatePath("/admin/seo");
  return ok(data as unknown as SeoMetadata);
}
