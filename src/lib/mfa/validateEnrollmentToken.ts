import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashSecret } from "@/lib/mfa/tokens";

/**
 * Validates an MFA enrollment token and returns the user_id it's bound
 * to, or null on any failure (invalid / expired / consumed). Constant-
 * time path — does not differentiate "unknown" from "expired" via
 * timing or error-message channel.
 *
 * Used at /admin/mfa-enroll to gate the QR code reveal.
 *
 * The token is NOT consumed here. Consumption is a separate step
 * (`consumeEnrollmentToken`) that fires only after the user has
 * successfully verified their first TOTP code, so an interrupted
 * enrollment (browser closed mid-flow) can be resumed with the same
 * token until expiry.
 */
export async function validateEnrollmentToken(
  plaintext: string
): Promise<{ userId: string; tokenId: string } | null> {
  if (!plaintext || plaintext.length < 16) return null;

  let hash: string;
  try {
    hash = hashSecret(plaintext);
  } catch {
    // Pepper not configured — fail closed.
    return null;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("mfa_enrollment_tokens")
    .select("id, user_id, expires_at, consumed_at")
    .eq("token_hash", hash)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as {
    id: string;
    user_id: string;
    expires_at: string;
    consumed_at: string | null;
  };

  if (row.consumed_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  return { userId: row.user_id, tokenId: row.id };
}
