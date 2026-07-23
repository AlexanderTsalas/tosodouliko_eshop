"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { MediaAsset } from "@/types/media-library";

const Schema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/),
  sizeBytes: z.number().int().positive().max(50 * 1024 * 1024),
  bucket: z.string().min(1).default("media"),
  folder: z.string().optional(),
  altText: z.string().max(500).optional(),
  isPublic: z.boolean().optional().default(false),
  storageKey: z.string().min(1),
});

/**
 * Records a media asset row after the actual file has been uploaded to
 * Supabase Storage. The Storage upload itself is performed client-side via
 * the browser Supabase client; this action just persists metadata + audit.
 */
export async function uploadMedia(
  input: z.input<typeof Schema>
): Promise<Result<MediaAsset>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<MediaAsset>("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<MediaAsset>("Not authenticated", "UNAUTHENTICATED");

  const { data, error } = await supabase
    .from("media_assets")
    .insert({
      uploader_id: authData.user.id,
      bucket: parsed.data.bucket,
      storage_key: parsed.data.storageKey,
      filename: parsed.data.filename,
      mime_type: parsed.data.mimeType,
      size_bytes: parsed.data.sizeBytes,
      alt_text: parsed.data.altText ?? null,
      folder: parsed.data.folder ?? null,
      is_public: parsed.data.isPublic ?? false,
    })
    .select()
    .single();

  if (error || !data) return fail<MediaAsset>(error?.message ?? "Insert failed", error?.code);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "media.uploaded",
    resource_type: "media_asset",
    resource_id: (data as any).id,
    metadata: { filename: parsed.data.filename, sizeBytes: parsed.data.sizeBytes },
  });

  return ok(data as unknown as MediaAsset);
}
