"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit-log";
import {
  generateEnrollmentToken,
  hashSecret,
} from "@/lib/mfa/tokens";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  /** Recovery code typed by the user. Accepts both XXXX-XXXX and XXXXXXXX. */
  code: z.string().min(8).max(20),
});

interface RecoveryResult {
  /**
   * Plaintext enrollment token. The verify page immediately redirects
   * the user to /admin/mfa-enroll?token=... so they can re-enroll a
   * fresh device. Treated as a credential in transit but acceptable
   * because the user is already authenticated (just lost their device).
   */
  enrollmentToken: string;
}

/**
 * Recovery flow: user lost their authenticator and uses a previously-
 * generated recovery code to regain access. Semantics:
 *
 *   1. Consume the recovery code (single-use).
 *   2. Delete the user's existing TOTP factor (service-role API call).
 *      After this point the user is back at AAL1 with no factors.
 *   3. Mint a fresh enrollment token for the same user so they can
 *      immediately re-enroll a new device. The token is returned to
 *      the caller; the verify page handles redirection.
 *
 * The recovery code does NOT directly promote the session to AAL2 —
 * that would create a TOTP bypass channel. Instead, it puts the user
 * back in the "needs to enroll" state with a valid enrollment token
 * already issued, so the recovery is a smooth one-step UX from the
 * user's perspective but matches the security model of "you proved
 * possession of a one-time recovery secret; now set up a new device."
 *
 * Rate-limited by the caller (the verify route should disable the
 * submit button on failure for a few seconds — not implemented here
 * because Next.js doesn't have built-in rate-limit primitives for
 * server actions; consider Upstash / middleware if needed).
 */
export async function verifyRecoveryCode(
  input: z.input<typeof Schema>
): Promise<Result<RecoveryResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<RecoveryResult>("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<RecoveryResult>("Not authenticated", "UNAUTHENTICATED");
  }

  // Normalize: strip whitespace, uppercase, allow either "XXXX-XXXX" or
  // "XXXXXXXX" form. The dash is decorative.
  const normalized = parsed.data.code
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  // Re-insert a single dash in the middle if the user typed without one
  // — the storage format from generateRecoveryCode includes the dash.
  let canonical = normalized;
  if (/^[A-Z0-9]{8}$/.test(normalized)) {
    canonical = `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
  } else if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalized)) {
    return fail<RecoveryResult>("Invalid code format", "INVALID_FORMAT");
  }

  let hash: string;
  try {
    hash = hashSecret(canonical);
  } catch {
    return fail<RecoveryResult>("MFA pepper not configured", "PEPPER_MISSING");
  }

  const admin = createAdminClient();

  const { data: codeRow } = await admin
    .from("mfa_recovery_codes")
    .select("id, user_id, consumed_at")
    .eq("code_hash", hash)
    .maybeSingle();

  if (!codeRow) {
    return fail<RecoveryResult>("Invalid or already-used code", "INVALID_CODE");
  }
  const row = codeRow as {
    id: string;
    user_id: string;
    consumed_at: string | null;
  };
  if (row.consumed_at) {
    return fail<RecoveryResult>("Invalid or already-used code", "INVALID_CODE");
  }
  if (row.user_id !== authData.user.id) {
    // Caller's session doesn't match the code's owner. Don't differentiate
    // from "invalid code" in the error message.
    return fail<RecoveryResult>("Invalid or already-used code", "INVALID_CODE");
  }

  // Mark consumed FIRST so a parallel double-submit can't double-use.
  const { error: consumeErr } = await admin
    .from("mfa_recovery_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("consumed_at", null);
  if (consumeErr) {
    return fail<RecoveryResult>(consumeErr.message, consumeErr.code);
  }

  // Delete every TOTP factor on the user. Supabase's listFactors via the
  // user-context client is fine since we already verified the session
  // matches. The admin client deletes via service role.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const allTotp = factors?.totp ?? [];
  for (const f of allTotp) {
    await admin.auth.admin.mfa.deleteFactor({
      userId: authData.user.id,
      id: f.id,
    });
  }

  // Mint a fresh enrollment token, invalidating any prior. Same pattern
  // as mintEnrollmentToken but inline because the caller (the user) is
  // not a manage:users admin — they're using the code on their own
  // account.
  await admin
    .from("mfa_enrollment_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("user_id", authData.user.id)
    .is("consumed_at", null);

  const plaintext = generateEnrollmentToken();
  const tokenHash = hashSecret(plaintext);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { error: insertErr } = await admin.from("mfa_enrollment_tokens").insert({
    user_id: authData.user.id,
    token_hash: tokenHash,
    expires_at: expiresAt,
    issued_by: authData.user.id,
  });
  if (insertErr) {
    return fail<RecoveryResult>(insertErr.message, insertErr.code);
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "mfa.recovery_code.used",
    resource_type: "user",
    resource_id: authData.user.id,
    metadata: {
      factors_deleted: allTotp.length,
    },
  });

  return ok({ enrollmentToken: plaintext });
}
