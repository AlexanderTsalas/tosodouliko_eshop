import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Server guard that requires the current session to be at Assurance Level 2
 * (AAL2 — second-factor verified). Use AFTER `requirePermission()` in admin
 * pages, so anyone who reaches AdminLayout must have both an admin permission
 * AND have completed an MFA challenge.
 *
 * Redirect routing:
 *   - aal2 already            -> no-op, returns
 *   - aal1 + has TOTP factors -> /admin/mfa-verify (sign back in via the
 *                                second factor)
 *   - aal1 + no factors yet   -> /admin/mfa-enroll (one-time enrollment;
 *                                the page itself does NOT call requireMFA,
 *                                otherwise we'd redirect-loop)
 *   - no session              -> /auth/signin
 *
 * Implementation note: we treat the older `currentLevel` enum value `aal1`
 * as "not verified" — Supabase upgrades to `aal2` on successful TOTP verify.
 */
export async function requireMFA(): Promise<void> {
  const supabase = await createClient();
  const { data: levelData, error: levelErr } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (levelErr) {
    // The auth client returns an error if there's no session at all.
    redirect("/auth/signin");
  }

  if (levelData?.currentLevel === "aal2") return;

  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const verified = factorsData?.totp?.filter((f) => f.status === "verified") ?? [];
  if (verified.length > 0) {
    redirect("/admin/mfa-verify");
  }
  redirect("/admin/mfa-enroll");
}
