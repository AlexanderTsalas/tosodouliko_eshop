import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

/**
 * Cookie-based Supabase client for server components, server actions, and
 * route handlers. The `<Database>` generic is intentionally NOT passed —
 * we'll add it once `npx supabase gen types typescript` produces the real
 * schema types. Until then, queries return loose `any`-typed rows.
 *
 * **ASYNC** — Phase 1 of the Next.js 14 → 16 upgrade. The factory itself
 * is async-ready so that when Next.js 15's `cookies()` becomes
 * Promise-returning, the only change needed inside this file is adding
 * `await` in front of `cookies()`. All 268 call sites already use
 * `await createClient()` from this phase forward, so the version bump
 * in Phase 2 is decoupled from the call-site rewrites.
 *
 * On Next.js 14, `cookies()` returns synchronously — the `await` here
 * just wraps a resolved value, no runtime cost.
 *
 * Companion factory: `createAdminClient()` in `src/lib/supabase/admin.ts`
 * stays SYNCHRONOUS (uses service-role key, no cookies). The two
 * factories behave differently on purpose.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    getSupabaseUrl(),
    getSupabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[]
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — middleware refreshes the session.
          }
        },
      },
    }
  );
}
