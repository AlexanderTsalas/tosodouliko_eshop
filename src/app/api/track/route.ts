import { NextResponse, type NextRequest } from "next/server";
import { trackEvent } from "@/lib/user-tracking";

// POST analytics — never cache. Explicit for Next.js 15 forward-compat
// (the implicit "cached by default" behavior of route handlers flipped
// in 15; declaring force-dynamic keeps behavior identical across 14/15/16).
export const dynamic = "force-dynamic";

/**
 * Lightweight tracking endpoint for client-side beacons (page views, etc.).
 * Anonymous-friendly; RLS allows INSERT for both anon and authenticated.
 */
export async function POST(request: NextRequest) {
  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!payload?.sessionId || !payload?.eventName) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  await trackEvent({
    sessionId: String(payload.sessionId),
    userId: payload.userId ? String(payload.userId) : null,
    eventName: String(payload.eventName),
    properties: payload.properties ?? undefined,
    url: payload.url ? String(payload.url) : undefined,
    referrer: payload.referrer ? String(payload.referrer) : undefined,
  });

  return NextResponse.json({ ok: true });
}
