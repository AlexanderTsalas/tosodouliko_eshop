import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

/**
 * Browser Supabase client (anon key, stateless). Safe to call in client
 * components and hooks — never expose service-role credentials here.
 *
 * The `<Database>` generic is intentionally NOT passed — see comment in
 * `./server.ts`.
 */
export function createClient() {
  return createBrowserClient(getSupabaseUrl(), getSupabaseAnonKey());
}
