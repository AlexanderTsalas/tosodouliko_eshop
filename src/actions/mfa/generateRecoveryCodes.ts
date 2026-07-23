"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit-log";
import { generateRecoveryCode, hashSecret } from "@/lib/mfa/tokens";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  /** How many codes to generate. Default 10 — industry standard. */
  count: z.number().int().min(4).max(20).default(10),
});

interface CodesResult {
  /** Plaintext codes — shown ONCE to the admin, then discarded. */
  codes: string[];
}

/**
 * Generates a fresh set of recovery codes for the CURRENT authenticated
 * user. Any prior un-consumed codes are invalidated (regenerating a set
 * supersedes any in-flight codes — admins shouldn't carry two disjoint
 * recovery sheets).
 *
 * Called at the end of successful MFA enrollment. Plaintext codes are
 * returned exactly once; the database stores only their hashes.
 *
 * Authentication is implicit (current user). The user must already have
 * a verified TOTP factor — calling this without one would create codes
 * usable by an attacker before legitimate enrollment completes. The
 * caller (the enroll form) only invokes this AFTER successful TOTP
 * verify, so the invariant holds.
 */
export async function generateRecoveryCodes(
  input: z.input<typeof Schema> = {}
): Promise<Result<CodesResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<CodesResult>("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<CodesResult>("Not authenticated", "UNAUTHENTICATED");
  }

  // Defensive: require at least one verified TOTP factor before issuing
  // recovery codes. Otherwise the codes would be a one-factor bypass.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = factors?.totp?.filter((f) => f.status === "verified") ?? [];
  if (verified.length === 0) {
    return fail<CodesResult>(
      "No verified TOTP factor — enroll first.",
      "NO_VERIFIED_FACTOR"
    );
  }

  const admin = createAdminClient();

  // Invalidate prior unused codes so an admin can't accumulate stacks of
  // valid sheets after multiple enrollments.
  await admin
    .from("mfa_recovery_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("user_id", authData.user.id)
    .is("consumed_at", null);

  let codes: string[];
  let hashes: string[];
  try {
    codes = Array.from({ length: parsed.data.count }, () => generateRecoveryCode());
    hashes = codes.map((c) => hashSecret(c));
  } catch (e) {
    return fail<CodesResult>(
      `MFA pepper not configured: ${(e as Error).message}`,
      "PEPPER_MISSING"
    );
  }

  // Guard against (astronomically unlikely) duplicate generation.
  const uniqueHashes = Array.from(new Set(hashes));
  if (uniqueHashes.length !== hashes.length) {
    return fail<CodesResult>("Code generation collision; retry.", "COLLISION");
  }

  const rows = hashes.map((h) => ({
    user_id: authData.user!.id,
    code_hash: h,
  }));
  const { error } = await admin.from("mfa_recovery_codes").insert(rows);
  if (error) {
    return fail<CodesResult>(error.message, error.code);
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "mfa.recovery_codes.generated",
    resource_type: "user",
    resource_id: authData.user.id,
    metadata: { count: codes.length },
  });

  return ok({ codes });
}
