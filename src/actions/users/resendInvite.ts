"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { sendEmail } from "@/lib/email";
import { renderInternalInvite } from "@/lib/email/templates/internalInvite";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ userId: z.string().uuid() });

interface ResendResult {
  setPasswordUrl: string;
  emailDelivered: boolean;
}

/**
 * Re-issue the set-password link for a user who hasn't finished onboarding
 * (invite expired / email lost). Uses generateLink({type:'recovery'}) — the
 * 'invite' type only works for a not-yet-existing user, whereas recovery
 * re-issues a set-password entry for an existing one. The /auth/accept-invite
 * page handles both types.
 *
 * Does NOT touch MFA — that's re-issued separately via mintEnrollmentToken.
 */
export async function resendInvite(
  input: z.infer<typeof Schema>
): Promise<Result<ResendResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<ResendResult>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:users"))) {
    return fail<ResendResult>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<ResendResult>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  const { data: target } = await admin.auth.admin.getUserById(parsed.data.userId);
  if (!target?.user?.email) {
    return fail<ResendResult>("User not found", "NOT_FOUND");
  }
  const email = target.user.email;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${siteUrl}/auth/accept-invite` },
  });
  if (linkErr || !linkData.properties?.hashed_token) {
    return fail<ResendResult>(linkErr?.message ?? "Link generation failed", linkErr?.code);
  }

  const setPasswordUrl = `${siteUrl}/auth/accept-invite?token_hash=${encodeURIComponent(
    linkData.properties.hashed_token
  )}&type=recovery`;

  const inviteExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const rendered = renderInternalInvite({
    recipient_name:
      (target.user.user_metadata?.first_name as string | undefined) ?? null,
    set_password_url: setPasswordUrl,
    expires_at: inviteExpiresAt,
    inviter_name:
      (authData.user.user_metadata?.first_name as string | undefined) ?? null,
  });
  const emailResult = await sendEmail({
    to: email,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    templateId: "internal.invite",
  });
  const emailDelivered =
    emailResult.success &&
    !/^(dev-|noop-|dedup-)/.test(emailResult.data.provider_message_id);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "user.invite_resent",
    resource_type: "user",
    resource_id: parsed.data.userId,
    metadata: { email },
  });

  revalidatePath(`/admin/users/${parsed.data.userId}`);
  return ok({ setPasswordUrl, emailDelivered });
}
