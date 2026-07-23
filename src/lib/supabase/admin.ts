import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "./env";

/**
 * Server-only — never import in client components or hooks. Bypasses RLS via
 * the service role key.
 *
 * The `<Database>` generic is intentionally NOT passed — see comment in
 * `./server.ts`.
 */
export function createAdminClient() {
  return createSupabaseClient(
    getSupabaseUrl(),
    getSupabaseServiceRoleKey(),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
