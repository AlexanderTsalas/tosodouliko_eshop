import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// OAuth/email-confirmation callback — stateful, must run per-request.
// Explicit for Next.js 15 forward-compat.
export const dynamic = "force-dynamic";

/**
 * Supabase email-confirmation callback. Exchanges the `code` query param for
 * a session, then redirects to the home page (or `next=` if provided).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(new URL("/auth/signin?error=no_code", url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(`/auth/signin?error=${encodeURIComponent(error.message)}`, url.origin)
    );
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
