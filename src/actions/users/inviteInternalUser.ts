"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { generateEnrollmentToken, hashSecret } from "@/lib/mfa/tokens";
import { sendEmail } from "@/lib/email";
import { renderInternalInvite } from "@/lib/email/templates/internalInvite";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  marketingOptIn: z.boolean().default(false),
  // Extra roles on top of the auto-assigned `customer` role. May be empty —
  // an internal user with no roles yet can be granted them later.
  roleIds: z.array(z.string().uuid()).default([]),
});

interface InviteResult {
  userId: string;
  invited: true;
  /** Set-password link — emailed AND returned so the UI can offer a copy
   *  fallback when email delivery isn't configured / fails. */
  setPasswordUrl: string;
  /** Whether the invite email was actually dispatched (false when no email
   *  provider is configured — the admin must relay the link manually). */
  emailDelivered: boolean;
  /** One-time MFA enrollment token — delivered OUT-OF-BAND by the admin, never
   *  by email. Present unless the pepper is unconfigured. */
  enrollmentToken?: string;
  enrollmentTokenExpiresAt?: string;
}

/**
 * Invite a new INTERNAL (back-office) user. Two-channel onboarding:
 *   1. A Supabase invite link (set-password) — emailed to the user, and also
 *      returned for a copy fallback.
 *   2. A one-time MFA enrollment token — returned to the inviting admin to
 *      deliver on a SEPARATE channel (never email), so email compromise alone
 *      can't complete /admin access.
 *
 * We use admin.generateLink({type:'invite'}) rather than inviteUserByEmail so
 * we build our own /auth/accept-invite URL around the hashed_token: that page
 * uses verifyOtp({type:'invite'}) which needs no PKCE code_verifier (the link
 * is minted by the cookieless service-role client, so exchangeCodeForSession
 * would fail). generateLink still creates the auth user (no password), firing
 * the handle_new_user trigger.
 */
export async function inviteInternalUser(
  input: z.input<typeof Schema>
): Promise<Result<InviteResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<InviteResult>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:users"))) {
    return fail<InviteResult>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<InviteResult>("Not authenticated", "UNAUTHENTICATED");
  }

  const admin = createAdminClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  // Create the user (no password) + get the invite token_hash.
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "invite",
    email: parsed.data.email,
    options: {
      data: {
        first_name: parsed.data.firstName,
        last_name: parsed.data.lastName,
        marketing_opt_in: parsed.data.marketingOptIn,
      },
      redirectTo: `${siteUrl}/auth/accept-invite`,
    },
  });

  if (linkErr || !linkData.user) {
    const msg = linkErr?.message?.toLowerCase() ?? "";
    if (msg.includes("already") || msg.includes("registered")) {
      return fail<InviteResult>("User with this email already exists", "DUPLICATE");
    }
    return fail<InviteResult>(linkErr?.message ?? "Invite failed", linkErr?.code);
  }

  const userId = linkData.user.id;
  const hashedToken = linkData.properties?.hashed_token;
  if (!hashedToken) {
    return fail<InviteResult>("Invite link generation returned no token", "NO_TOKEN");
  }
  const setPasswordUrl = `${siteUrl}/auth/accept-invite?token_hash=${encodeURIComponent(
    hashedToken
  )}&type=invite`;

  // Mark internal (service role bypasses the account_type guard trigger) and
  // assign any extra roles.
  await admin
    .from("user_profiles")
    .update({ account_type: "internal" })
    .eq("id", userId);

  if (parsed.data.roleIds.length > 0) {
    const rows = parsed.data.roleIds.map((rid) => ({
      user_id: userId,
      role_id: rid,
      assigned_by: authData.user.id,
    }));
    await admin.from("user_roles").upsert(rows, { onConflict: "user_id,role_id" });
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "user.invited",
    resource_type: "user",
    resource_id: userId,
    metadata: { email: parsed.data.email, extraRoles: parsed.data.roleIds.length },
  });

  // Mint the out-of-band MFA enrollment token (required to complete /admin
  // access). Best-effort: if the pepper is unconfigured we still return the
  // invite so the admin can fix config + re-issue via the detail page.
  let enrollmentToken: string | undefined;
  let enrollmentTokenExpiresAt: string | undefined;
  try {
    const plaintext = generateEnrollmentToken();
    const hash = hashSecret(plaintext);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error: tokenErr } = await admin.from("mfa_enrollment_tokens").insert({
      user_id: userId,
      token_hash: hash,
      expires_at: expiresAt,
      issued_by: authData.user.id,
    });
    if (!tokenErr) {
      enrollmentToken = plaintext;
      enrollmentTokenExpiresAt = expiresAt;
      await logAuditEvent({
        actor_id: authData.user.id,
        actor_type: "user",
        action: "mfa.enrollment_token.minted",
        resource_type: "user",
        resource_id: userId,
        metadata: { source: "invite", ttl_hours: 24 },
      });
    } else {
      console.error("[inviteInternalUser] enrollment token insert failed:", tokenErr.message);
    }
  } catch (e) {
    console.error(
      "[inviteInternalUser] MFA pepper not configured; invited without enrollment token:",
      (e as Error).message
    );
  }

  // Send the invite email (best-effort — never fail the invite on email).
  const inviteExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const rendered = renderInternalInvite({
    recipient_name: parsed.data.firstName || null,
    set_password_url: setPasswordUrl,
    expires_at: inviteExpiresAt,
    inviter_name:
      (authData.user.user_metadata?.first_name as string | undefined) ?? null,
  });
  const emailResult = await sendEmail({
    to: parsed.data.email,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    templateId: "internal.invite",
  });
  // A configured provider returns a real id; the no-provider no-op path returns
  // a `dev-`/`noop-` id — treat those as "not actually delivered".
  const emailDelivered =
    emailResult.success &&
    !/^(dev-|noop-|dedup-)/.test(emailResult.data.provider_message_id);

  revalidatePath("/admin/users");
  return ok({
    userId,
    invited: true,
    setPasswordUrl,
    emailDelivered,
    enrollmentToken,
    enrollmentTokenExpiresAt,
  });
}
