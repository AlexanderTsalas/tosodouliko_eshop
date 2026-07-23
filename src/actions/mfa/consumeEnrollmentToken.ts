"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit-log";
import { validateEnrollmentToken } from "@/lib/mfa/validateEnrollmentToken";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  token: z.string().min(16).max(200),
});

/**
 * Marks an enrollment token as consumed. Called by the enrollment form
 * AFTER a successful TOTP verify — never before, so that an interrupted
 * flow can be resumed (closing the browser mid-scan shouldn't invalidate
 * the token).
 *
 * Authentication is implicit: the caller must hold a session for the
 * same user_id that the token is bound to. We re-validate the token
 * here (rather than trusting a passed-in userId) so a stolen valid
 * session can't consume a different user's token.
 */
export async function consumeEnrollmentToken(
  input: z.input<typeof Schema>
): Promise<Result<{ ok: true }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail("Not authenticated", "UNAUTHENTICATED");

  const validated = await validateEnrollmentToken(parsed.data.token);
  if (!validated) {
    return fail<{ ok: true }>("Invalid or expired token", "INVALID_TOKEN");
  }
  if (validated.userId !== authData.user.id) {
    // Session belongs to a different user than the token. Defensive —
    // shouldn't happen via the normal flow, but blocks the case where a
    // user with a valid session somehow obtained another user's token.
    return fail<{ ok: true }>("Token mismatch", "TOKEN_MISMATCH");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("mfa_enrollment_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", validated.tokenId)
    .is("consumed_at", null);
  if (error) return fail<{ ok: true }>(error.message, error.code);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "mfa.enrollment_token.consumed",
    resource_type: "user",
    resource_id: authData.user.id,
    metadata: {},
  });

  return ok({ ok: true });
}
