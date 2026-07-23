import { createClient } from "@/lib/supabase/server";

/**
 * Returns the current Supabase session (or null). Use in server components &
 * server actions to gate by authentication.
 *
 * Note: this DOES NOT use `'use server'` because it's not a form-submittable
 * action — it's read in server components. Importing from a Client Component
 * is a build error (it's typed for server use only).
 */
export async function getSession() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}
