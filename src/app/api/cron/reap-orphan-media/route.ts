import { NextResponse, type NextRequest } from "next/server";
import { reapOrphanMedia } from "@/lib/media/reapOrphanMedia";

// Cron tick — scans storage + deletes orphans per invocation. Never cache.
export const dynamic = "force-dynamic";

/**
 * Phase 7 of the product-images plan — orphan media reaper.
 *
 * Cleans up storage objects in the product-images bucket that aren't
 * referenced by any `product_images.storage_key` or
 * `media_assets.storage_key` AND were last modified more than 24
 * hours ago. The window protects against the race where a
 * browser-direct upload completed but the `recordProductImage`
 * server action hasn't fired yet (admin tab closed mid-upload, etc.).
 *
 * Auth: shared `CRON_SECRET` env var via Bearer header. Vercel Cron
 * sets it automatically when configured.
 *
 * Schedule (suggested nightly at 04:15 UTC):
 *   - Vercel Cron: `15 4 * * * /api/cron/reap-orphan-media`
 *   - pg_cron + pg_net: SELECT cron.schedule('reap-orphan-media',
 *       '15 4 * * *',
 *       $$ SELECT net.http_post(
 *         url:='https://example.com/api/cron/reap-orphan-media',
 *         headers:='{"Authorization": "Bearer <CRON_SECRET>"}'::jsonb) $$);
 *   - External: cron-job.org / GitHub Actions hitting the URL.
 *
 * Budget:
 *   - Pages up to 10,000 keys per run
 *   - Deletes up to 500 objects per run
 *   - Subsequent runs pick up the next chunk on the following tick
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = request.headers.get("authorization");
    if (header !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "CRON_SECRET is required in production" },
      { status: 500 }
    );
  }

  try {
    const result = await reapOrphanMedia();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "reaper failed",
      },
      { status: 500 }
    );
  }
}

// POST = GET — supports pg_cron's net.http_post and Vercel Cron's GET.
export const POST = GET;
