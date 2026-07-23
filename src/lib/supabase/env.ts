/**
 * Supabase URL/key resolution with a placeholder fallback for
 * frontend-only preview deploys (no backend configured yet). Client
 * *construction* never throws; requests against the placeholder host
 * simply fail over the network, and callers already handle Supabase
 * errors via `{ success, data }` / `{ error }` results rather than
 * letting them throw. Real deployments set the real env vars and this
 * fallback is never used.
 */
const PLACEHOLDER_URL = "https://placeholder.invalid";
const PLACEHOLDER_ANON_KEY = "placeholder-anon-key";
const PLACEHOLDER_SERVICE_ROLE_KEY = "placeholder-service-role-key";

export function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || PLACEHOLDER_URL;
}

export function getSupabaseAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || PLACEHOLDER_ANON_KEY;
}

export function getSupabaseServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || PLACEHOLDER_SERVICE_ROLE_KEY;
}
