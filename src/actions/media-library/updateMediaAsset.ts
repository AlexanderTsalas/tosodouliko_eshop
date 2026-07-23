"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { MediaAsset } from "@/types/media-library";

const Schema = z.object({
  id: z.string().uuid(),
  altText: z.string().max(500).nullable().optional(),
  folder: z.string().max(200).nullable().optional(),
  isPublic: z.boolean().optional(),
});

export async function updateMediaAsset(
  input: z.input<typeof Schema>
): Promise<Result<MediaAsset>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<MediaAsset>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:media"))) {
    return fail<MediaAsset>("Forbidden", "FORBIDDEN");
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.altText !== undefined) update.alt_text = parsed.data.altText;
  if (parsed.data.folder !== undefined) update.folder = parsed.data.folder;
  if (parsed.data.isPublic !== undefined) update.is_public = parsed.data.isPublic;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("media_assets")
    .update(update)
    .eq("id", parsed.data.id)
    .select()
    .single();

  if (error || !data) return fail<MediaAsset>(error?.message ?? "Update failed", error?.code);
  revalidatePath("/admin/media");
  return ok(data as unknown as MediaAsset);
}
