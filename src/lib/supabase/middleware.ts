import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

export async function updateSession(request: NextRequest) {
  // Response-only cookie pattern (Phase 2.2 of the Next.js upgrade).
  //
  // Pre-15, the Supabase SSR docs used a request-phase mutation pattern
  // where `request.cookies.set(...)` was called inside the setAll
  // callback, then a fresh `NextResponse.next({ request })` was
  // constructed to carry those cookies forward. In Next.js 15+ that
  // pattern becomes fragile: mutating request.cookies mid-handler can
  // cause subtle inconsistencies with the request-scoped storage that
  // backs both cookies() and request.cookies.
  //
  // The cleaner pattern below writes ONLY to the response. The next
  // HTTP request from the browser will carry the updated cookies
  // automatically; the current request doesn't need them mid-flight
  // because supabase.auth.getUser() below uses the bearer token from
  // the inbound request.cookies (read-only via getAll()).
  //
  // Also: expose the pathname to downstream server components via a
  // request header. Server components read it via
  // `(await headers()).get('x-pathname')`. Used by src/app/admin/layout.tsx
  // to skip the admin chrome on the MFA enroll/verify pages (those
  // can't sit inside the chrome's MFA gate without a redirect loop).
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("x-pathname", request.nextUrl.pathname);
  const response = NextResponse.next({
    request: { headers: forwardedHeaders },
  });

  const supabase = createServerClient(
    getSupabaseUrl(),
    getSupabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[]
        ) {
          // Response-phase only — write directly to the outgoing
          // response cookies. No request-phase mutation; no
          // NextResponse.next() reconstruction.
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  // Trigger Supabase to refresh the session if needed. If a refresh
  // occurs, the new tokens flow through setAll() above and land on
  // the outgoing response.
  await supabase.auth.getUser();

  // Baseline security headers (TD-3, docs/technical-debt.md).
  //
  // - X-Frame-Options: DENY      — blocks clickjacking via cross-origin
  //   iframe embedding. Codebase has no internal iframe usage; Stripe
  //   Elements (if added later) creates child iframes inside our pages,
  //   which DENY does not affect.
  // - X-Content-Type-Options: nosniff — disables MIME-sniffing fallback;
  //   forces browsers to trust the declared Content-Type.
  // - Referrer-Policy: strict-origin-when-cross-origin — when the user
  //   navigates from our site to an external site, only the origin
  //   (e.g. "https://example.com") is sent, not the full URL with paths or
  //   query params (which may contain order ids, session ids, etc.).
  //
  // HSTS deliberately not set here yet — see TD-3 in docs/technical-debt.md
  // for the ramp plan (start at max-age=86400, ramp to 1 year over weeks
  // once HTTPS stability is confirmed).
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set(
    "Referrer-Policy",
    "strict-origin-when-cross-origin"
  );

  return response;
}
