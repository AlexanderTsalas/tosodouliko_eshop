"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

/**
 * Mark a `system_errors` row as resolved (or unresolved). Used by the
 * /admin/system-errors page's "Επιλύθηκε" / "Επαναφορά" button after
 * an operator has investigated the underlying DB-side issue.
 *
 * Separate from `setErrorResolved` (which operates on `error_events` —
 * application-layer errors). system_errors specifically captures
 * Postgres-side exceptions caught by typed-SQLSTATE catches in reapers
 * + atomic RPCs (see Phase 8 of the data-layer remediation).
 */
const Schema = z.object({
  id: z.string().uuid(),
  resolved: z.boolean(),
});

export async function markSystemErrorResolved(
  input: z.input<typeof Schema>
): Promise<Result<null>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<null>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("read:errors"))) {
    return fail<null>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<null>("Not authenticated", "UNAUTHENTICATED");

  // Resolve the auth user → user_profiles.id so resolved_by is the
  // correct FK target (the column references user_profiles, not auth.users).
  const { data: profileRow } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  const resolvedByUserProfileId =
    (profileRow as { id: string } | null)?.id ?? null;

  const admin = createAdminClient();
  const patch = parsed.data.resolved
    ? {
        resolved_at: new Date().toISOString(),
        resolved_by: resolvedByUserProfileId,
      }
    : { resolved_at: null, resolved_by: null };

  const { error } = await admin
    .from("system_errors")
    .update(patch)
    .eq("id", parsed.data.id);

  if (error) return fail<null>(error.message, error.code);

  revalidatePath("/admin/system-errors");
  return ok(null);
}
