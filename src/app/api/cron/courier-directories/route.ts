import { NextResponse, type NextRequest } from "next/server";
import { refreshDirectories } from "@/actions/courier-cron/refreshDirectories";

// Cron tick — refreshes carrier location caches per invocation. Never cache.
export const dynamic = "force-dynamic";

/**
 * Phase 10 — periodic refresh of courier directory caches
 * (couriers_location_cache rows for ACS stations, BoxNow lockers, etc.).
 *
 * Auth: shared `CRON_SECRET` env var via Bearer header. Vercel Cron sets
 * it automatically when configured; external schedulers (pg_cron, GitHub
 * Actions, cron-job.org) must add the matching header. In dev (no
 * NODE_ENV=production AND no CRON_SECRET), the route is open to make
 * manual testing painless.
 *
 * Suggested schedule: weekly. Carrier directories turn over slowly and
 * the 30-day TTL gives plenty of headroom; the cron is mostly insurance
 * against the cache getting too stale to be useful for proximity sort.
 *
 *   - Vercel Cron: vercel.json entry → `0 3 * * 0 /api/cron/courier-directories`
 *   - pg_cron + pg_net: see migration 20260602000002_courier_directories_cron_via_pg_net.sql
 *   - External: cron-job.org / GitHub Actions pinging the URL weekly.
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
    const result = await refreshDirectories();
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
