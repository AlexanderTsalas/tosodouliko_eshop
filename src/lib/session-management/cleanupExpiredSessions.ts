import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type Result } from "@/types/result";

/**
 * Wraps the `public.cleanup_expired_sessions()` Postgres function. Run
 * periodically (e.g. via a cron job) to prune dead sessions.
 */
export async function cleanupExpiredSessions(): Promise<Result<{ deleted: number }>> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("cleanup_expired_sessions" as never);
  if (error) return fail<{ deleted: number }>(error.message, error.code);
  return ok({ deleted: 0 }); // RPC returns void; caller can query for counts separately.
}
