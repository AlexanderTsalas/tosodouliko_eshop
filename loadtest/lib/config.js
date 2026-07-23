/**
 * Shared k6 config for kids_eshop scenarios.
 *
 * BASE_URL — the running Next.js dev/prod server. Defaults to the local
 * dev server. Override via env when needed:
 *   k6 run -e BASE_URL=http://localhost:3001 scenarios/smoke.js
 *
 * Hard guard: refuses to point at anything other than localhost/127.0.0.1.
 * Load tests should NEVER hit the remote Supabase project — the seeding
 * conventions and rate-limit-bypass code assume LOCAL ONLY. If you really
 * need to test against staging, you'll need to consciously remove this
 * guard and re-think the LOAD_TEST=true bypass.
 */

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(BASE_URL)) {
  throw new Error(
    `Refusing to run: BASE_URL must point at localhost or 127.0.0.1. Got: ${BASE_URL}`
  );
}

export { BASE_URL };

/**
 * Storefront paths used across scenarios. Centralized so a route rename
 * doesn't require touching every scenario file.
 *
 * NOTE: PRODUCT_DETAIL is a template — call it as `PRODUCT_DETAIL(slug)`.
 */
export const PATHS = {
  HOME: "/",
  PRODUCT_DETAIL: (slug) => `/products/${slug}`,
};

/**
 * Seed product slugs (must match scripts/seed-loadtest.mjs). Imported by
 * scenarios that need a known-good product to hit.
 */
export const SEED_PRODUCT_SLUGS = [
  "trenaki-xylino",
  "kouklospito-mini",
  "puzzle-100-kommatia",
  "vivlio-paramyti",
  "vivlio-zographiki",
];

/**
 * Local Supabase stack — for scenarios that talk directly to the DB layer
 * (RPCs + tables via PostgREST + Auth) instead of via Next.js.
 *
 * These are the local-stack defaults — deterministic across machines, baked
 * into supabase CLI. NOT secrets; safe to reference here.
 *
 * Same hard-localhost guard applies: scenarios refuse to point at anything
 * but loopback URLs.
 */
export const SUPABASE_URL = __ENV.SUPABASE_URL || "http://127.0.0.1:54321";
export const SUPABASE_PUBLISHABLE_KEY =
  __ENV.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

/**
 * Service-role key — bypasses RLS. Required by helpers that mirror the
 * production server-action pattern (use JWT only to identify the user, use
 * service_role for the actual DB operations — see joinSoftWaitQueue.ts,
 * placeOrder.ts, etc. in src/actions/).
 *
 * No committed default — even the deterministic local-stack key matches
 * GitHub secret-scanning's pattern for a live Supabase secret key and gets
 * push-protection-blocked. Get it via `supabase status -o env` and export
 * SUPABASE_SERVICE_ROLE_KEY, or pass -e SUPABASE_SERVICE_ROLE_KEY=... to k6.
 */
export const SUPABASE_SERVICE_ROLE_KEY = __ENV.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "Refusing to run: SUPABASE_SERVICE_ROLE_KEY is required. Get it via " +
      "`supabase status -o env` and pass -e SUPABASE_SERVICE_ROLE_KEY=... to k6."
  );
}

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(SUPABASE_URL)) {
  throw new Error(
    `Refusing to run: SUPABASE_URL must point at localhost or 127.0.0.1. Got: ${SUPABASE_URL}`
  );
}
