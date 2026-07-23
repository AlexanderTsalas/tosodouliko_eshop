import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getStorageProvider,
  DEFAULT_PRODUCT_IMAGES_BUCKET,
} from "@/lib/storage";

/**
 * Reap orphaned media — storage objects that don't have a matching
 * DB row in `product_images` or `media_assets`.
 *
 * Phase 7 of the product-images plan. Runs nightly via cron. The
 * 24-hour age window guards against the case where a presigned upload
 * just completed but the recording action hasn't fired yet
 * (race-window protection).
 *
 * Algorithm:
 *   1. Page through every key in the bucket via provider.list()
 *   2. For each page, query DB for matching storage_key in both
 *      product_images and media_assets — anything not found is a
 *      candidate
 *   3. Filter candidates older than the retention window
 *   4. Delete each via provider.delete()
 *
 * Budgeted: caps at MAX_PAGES * 1000 keys per run + MAX_DELETES per
 * run. Subsequent runs pick up where this one left off (next day's
 * tick handles overflow).
 */

interface ReapResult {
  scanned: number;
  candidates: number;
  deleted: number;
  errors: number;
  durationMs: number;
  budgetExhausted: boolean;
}

const RETENTION_HOURS = 24;
const MAX_PAGES = 10; // 10 × 1000 = 10k keys per run
const MAX_DELETES = 500; // cap deletes/run to limit blast radius

export async function reapOrphanMedia(args?: {
  bucket?: string;
  retentionHours?: number;
}): Promise<ReapResult> {
  const startedAt = Date.now();
  const bucket = args?.bucket ?? DEFAULT_PRODUCT_IMAGES_BUCKET;
  const retentionHours = args?.retentionHours ?? RETENTION_HOURS;
  const ageCutoffMs = startedAt - retentionHours * 60 * 60 * 1000;

  const provider = await getStorageProvider();
  const admin = createAdminClient();

  let scanned = 0;
  let candidates = 0;
  let deleted = 0;
  let errors = 0;
  let continuationToken: string | undefined;
  let pages = 0;
  let budgetExhausted = false;

  while (pages < MAX_PAGES) {
    pages += 1;
    const page = await provider.list({
      bucket,
      continuationToken,
      maxKeys: 1000,
    });
    scanned += page.objects.length;

    // Filter to candidates (old enough)
    const oldEnough = page.objects.filter(
      (obj) => obj.lastModifiedMs > 0 && obj.lastModifiedMs < ageCutoffMs
    );
    if (oldEnough.length === 0) {
      continuationToken = page.nextToken;
      if (!continuationToken) break;
      continue;
    }

    // Check DB for known storage_keys in both tables (parallel).
    const keys = oldEnough.map((o) => o.key);
    const [piRes, maRes] = await Promise.all([
      admin
        .from("product_images")
        .select("storage_key")
        .eq("bucket", bucket)
        .in("storage_key", keys),
      admin
        .from("media_assets")
        .select("storage_key")
        .eq("bucket", bucket)
        .in("storage_key", keys),
    ]);

    const knownKeys = new Set<string>();
    for (const r of ((piRes.data ?? []) as Array<{
      storage_key: string | null;
    }>)) {
      if (r.storage_key) knownKeys.add(r.storage_key);
    }
    for (const r of ((maRes.data ?? []) as Array<{
      storage_key: string | null;
    }>)) {
      if (r.storage_key) knownKeys.add(r.storage_key);
    }

    const orphanKeys = keys.filter((k) => !knownKeys.has(k));
    candidates += orphanKeys.length;

    for (const key of orphanKeys) {
      if (deleted >= MAX_DELETES) {
        budgetExhausted = true;
        break;
      }
      try {
        await provider.delete({ bucket, key });
        deleted += 1;
      } catch (err) {
        errors += 1;
        console.error(
          `[reapOrphanMedia] delete failed for ${bucket}/${key}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    if (budgetExhausted) break;
    continuationToken = page.nextToken;
    if (!continuationToken) break;
  }

  return {
    scanned,
    candidates,
    deleted,
    errors,
    durationMs: Date.now() - startedAt,
    budgetExhausted,
  };
}
