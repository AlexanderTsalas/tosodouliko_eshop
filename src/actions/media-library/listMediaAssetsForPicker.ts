"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { getImageUrl, DEFAULT_PRODUCT_IMAGES_BUCKET } from "@/lib/storage";
import { fail, ok, type Result } from "@/types/result";
import type { MediaAsset } from "@/types/media-library";
import type {
  MediaAssetForPicker,
  MediaPickerPage,
} from "@/types/media-picker";

// Note: type definitions moved to src/types/media-picker.ts because
// Next.js 15+ requires "use server" modules to export ONLY async
// functions. Type re-exports are not part of the public API of this
// module — consumers import types from @/types/media-picker directly.

const Schema = z.object({
  /** Page size (max 60). 24 is the default; aligns with a 4×6 / 6×4 grid. */
  pageSize: z.number().int().min(1).max(60).default(24),
  /** Offset for pagination. Cursor-based would be cleaner long-term but
   * offset is fine for typical picker workloads (≤ thousands of assets). */
  offset: z.number().int().nonnegative().default(0),
  /** Free-text search over filename + alt_text. ILIKE pattern. */
  search: z.string().trim().max(200).optional(),
  /** Optional folder filter (e.g. "products/some-slug"). */
  folder: z.string().trim().max(200).optional(),
});

/**
 * Server-side query for the MediaPickerModal. Returns image-only
 * media_assets paginated + optionally filtered. Includes resolved
 * `url` per item so the client renders thumbnails directly without
 * needing the storage abstraction.
 *
 * RBAC: requires `manage:products` (the picker is currently only used
 * from the product images tab). When the picker is reused elsewhere
 * we can broaden the permission set.
 */
export async function listMediaAssetsForPicker(
  input: z.input<typeof Schema>
): Promise<Result<MediaPickerPage>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<MediaPickerPage>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<MediaPickerPage>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();
  let query = admin
    .from("media_assets")
    .select("*", { count: "exact" })
    .like("mime_type", "image/%")
    .order("created_at", { ascending: false });

  if (parsed.data.search) {
    // Search across filename + alt_text. Build an or() filter with
    // escaped wildcards.
    const term = `%${parsed.data.search.replace(/[%_]/g, "\\$&")}%`;
    query = query.or(`filename.ilike.${term},alt_text.ilike.${term}`);
  }
  if (parsed.data.folder) {
    query = query.eq("folder", parsed.data.folder);
  }

  const start = parsed.data.offset;
  const end = parsed.data.offset + parsed.data.pageSize - 1;
  const { data, error, count } = await query.range(start, end);
  if (error) return fail<MediaPickerPage>(error.message, error.code);

  const rows = (data ?? []) as MediaAsset[];

  // Resolve URLs in parallel — every row needs its public URL for the
  // thumbnail grid. resolveImageUrl is a tiny synchronous wrap once
  // the provider cache is warm.
  const items = await Promise.all(
    rows.map(async (row): Promise<MediaAssetForPicker> => ({
      ...row,
      url: await getImageUrl(
        row.storage_key,
        row.bucket || DEFAULT_PRODUCT_IMAGES_BUCKET
      ),
    }))
  );

  const total = count ?? items.length;
  const hasMore = parsed.data.offset + items.length < total;

  return ok({ items, total, hasMore });
}
