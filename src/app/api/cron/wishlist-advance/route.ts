import { NextResponse, type NextRequest } from "next/server";
import { tickleWishlistDispatcher } from "@/lib/wishlist/tickleDispatcher";

// Cron tick — each invocation runs the dispatcher fresh. Never cache.
export const dynamic = "force-dynamic";

/**
 * Phase 6 follow-up — periodic cron entry point.
 *
 * Calls `tickleWishlistDispatcher` to advance the wishlist queue for any
 * variant whose active priority hold has expired (no inline TS trigger
 * exists for SQL-side expiry events, so the periodic sweep is the
 * mechanism).
 *
 * Auth: shared `CRON_SECRET` env var via Bearer header. Vercel Cron sets
 * it automatically when configured; external schedulers must add the
 * matching header.
 *
 * Schedule (suggested every minute):
 *   - Vercel Cron: vercel.json entry → `* * * * * /api/cron/wishlist-advance`
 *   - pg_cron + pg_net: SELECT cron.schedule('wishlist-advance', '* * * * *',
 *       $$ SELECT net.http_post(url:='https://example.com/api/cron/wishlist-advance',
 *           headers:='{"Authorization": "Bearer <CRON_SECRET>"}'::jsonb) $$);
 *   - External: cron-job.org / EasyCron / GitHub Actions pinging the URL.
 *
 * Self-hosted Supabase: same — the endpoint is plain HTTP.
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
    const result = await tickleWishlistDispatcher();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}

// POST = GET (lets pg_cron's net.http_post and Vercel Cron's GET both work).
export const POST = GET;
