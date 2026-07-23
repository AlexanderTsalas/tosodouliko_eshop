import { NextResponse, type NextRequest } from "next/server";
import { reapStaleDrafts } from "@/lib/products/reapStaleDrafts";

// Cron tick — deletes abandoned draft products per invocation. Never cache.
export const dynamic = "force-dynamic";

/**
 * Stale-draft reaper. Deletes `products` rows with `is_draft = true` that
 * haven't been touched (updated_at) for ≥ STALE_DRAFT_TTL_HOURS. Only
 * drafts are eligible, so intentionally-inactive finished products are
 * never affected. Cascades clean up variants/images rows; the media reaper
 * sweeps the orphaned storage blobs afterwards.
 *
 * Auth: shared `CRON_SECRET` via Bearer header (same convention as the
 * other cron endpoints).
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
    const result = await reapStaleDrafts();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "reaper failed" },
      { status: 500 }
    );
  }
}
