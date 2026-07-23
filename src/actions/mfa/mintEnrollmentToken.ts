"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import {
  generateEnrollmentToken,
  hashSecret,
} from "@/lib/mfa/tokens";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  userId: z.string().uuid(),
  /** Token validity window in hours (default 24, max 168 = 7 days). */
  ttlHours: z.number().int().min(1).max(168).default(24),
});

interface MintResult {
  /** Plaintext token — show to the caller exactly once, never again. */
  token: string;
  expiresAt: string;
}

/**
 * Mints a single-use MFA enrollment token for the named user. The caller
 * must hold `manage:users` (existing admins). The plaintext token is
 * returned ONLY to the caller's response; the database stores the hash.
 * The caller is responsible for delivering the token out-of-band to the
 * target user (print, in-person, encrypted channel).
 *
 * Any prior un-consumed token for the same user is invalidated — only
 * one active token per user at any time, so a "reset MFA" supersedes
 * any stale token that may be in flight.
 *
 * The token is what `/admin/mfa-enroll` consumes to reveal the TOTP QR
 * code. Without it, /admin/mfa-enroll refuses to render the QR — even
 * for a legitimately-authenticated user whose password an attacker has
 * just learned.
 */
export async function mintEnrollmentToken(
  input: z.input<typeof Schema>
): Promise<Result<MintResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<MintResult>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:users"))) {
    return fail<MintResult>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<MintResult>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();

  // Verify the target user exists. We don't require they hold admin
  // permissions here — the caller might be pre-provisioning. The actual
  // /admin/mfa-enroll page still checks the target has at least one
  // admin permission before rendering the QR.
  const { data: targetUser } = await admin.auth.admin.getUserById(parsed.data.userId);
  if (!targetUser?.user) {
    return fail<MintResult>("User not found", "NOT_FOUND");
  }

  // Invalidate prior un-consumed tokens — only one active token per user.
  await admin
    .from("mfa_enrollment_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("user_id", parsed.data.userId)
    .is("consumed_at", null);

  // Mint + insert.
  let plaintext: string;
  let hash: string;
  try {
    plaintext = generateEnrollmentToken();
    hash = hashSecret(plaintext);
  } catch (e) {
    return fail<MintResult>(
      `MFA pepper not configured: ${(e as Error).message}`,
      "PEPPER_MISSING"
    );
  }

  const expiresAt = new Date(
    Date.now() + parsed.data.ttlHours * 60 * 60 * 1000
  ).toISOString();

  const { error } = await admin.from("mfa_enrollment_tokens").insert({
    user_id: parsed.data.userId,
    token_hash: hash,
    expires_at: expiresAt,
    issued_by: authData.user.id,
  });
  if (error) {
    return fail<MintResult>(error.message, error.code);
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "mfa.enrollment_token.minted",
    resource_type: "user",
    resource_id: parsed.data.userId,
    metadata: {
      target_user_email: targetUser.user.email ?? null,
      ttl_hours: parsed.data.ttlHours,
    },
  });

  return ok({ token: plaintext, expiresAt });
}
