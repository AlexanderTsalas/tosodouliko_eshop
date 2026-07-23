/**
 * Internal-user onboarding invite email.
 *
 * Sent when an admin invites a new back-office (internal) user. Carries the
 * set-password link (Supabase invite, consumed by /auth/accept-invite). The
 * MFA enrollment token is delivered SEPARATELY, out-of-band, so email
 * compromise alone can't complete back-office access — the copy makes that
 * expectation explicit.
 */

export interface InternalInviteInput {
  recipient_name: string | null;
  /** Absolute set-password URL (/auth/accept-invite?token_hash=...&type=invite). */
  set_password_url: string;
  /** ISO expiry of the invite link. */
  expires_at: string;
  /** Name of the admin who sent the invite, for the copy. */
  inviter_name?: string | null;
}

export interface InternalInviteOutput {
  subject: string;
  text: string;
  html: string;
}

export function renderInternalInvite(
  input: InternalInviteInput
): InternalInviteOutput {
  const greeting = input.recipient_name
    ? `Γεια σας ${input.recipient_name},`
    : "Γεια σας,";
  const invitedBy = input.inviter_name ? ` από ${input.inviter_name}` : "";
  const expiryLabel = formatGreekDateTime(input.expires_at);

  const subject = "Πρόσκληση στο διαχειριστικό — ορίστε τον κωδικό σας";

  const text = [
    greeting,
    "",
    `Προσκληθήκατε${invitedBy} να αποκτήσετε πρόσβαση στο διαχειριστικό.`,
    "Ορίστε τον δικό σας κωδικό πρόσβασης ακολουθώντας τον σύνδεσμο:",
    "",
    input.set_password_url,
    "",
    `Ο σύνδεσμος λήγει: ${expiryLabel}`,
    "",
    "Μετά τον ορισμό κωδικού, για την ολοκλήρωση θα χρειαστείτε έναν",
    "ξεχωριστό κωδικό ενεργοποίησης MFA, τον οποίο θα σας δώσει ο",
    "διαχειριστής σας χωριστά (όχι μέσω email).",
    "",
    "Αν δεν περιμένατε αυτή την πρόσκληση, αγνοήστε αυτό το μήνυμα.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="el">
  <body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; color: #1a1a1a; max-width: 560px; margin: 0 auto; padding: 24px;">
    <p>${escapeHtml(greeting)}</p>
    <p>Προσκληθήκατε${escapeHtml(invitedBy)} να αποκτήσετε πρόσβαση στο διαχειριστικό. Ορίστε τον δικό σας κωδικό πρόσβασης:</p>
    <p style="text-align: center; margin: 24px 0;">
      <a href="${escapeAttr(input.set_password_url)}" style="display: inline-block; background: #1a1a1a; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">Ορισμός κωδικού →</a>
    </p>
    <p style="font-size: 0.9em; color: #6b7280;">Ο σύνδεσμος λήγει: <strong>${escapeHtml(expiryLabel)}</strong></p>
    <div style="border: 1px solid #f59e0b; background: #fffbeb; padding: 12px 16px; border-radius: 6px; margin: 16px 0; font-size: 0.95em;">
      <p style="margin: 0;">Μετά τον ορισμό κωδικού, θα χρειαστείτε έναν <strong>ξεχωριστό κωδικό ενεργοποίησης MFA</strong>, τον οποίο θα σας δώσει ο διαχειριστής σας χωριστά — ποτέ μέσω email.</p>
    </div>
    <p style="font-size: 0.85em; color: #6b7280;">Αν δεν περιμένατε αυτή την πρόσκληση, αγνοήστε αυτό το μήνυμα.</p>
  </body>
</html>`;

  return { subject, text, html };
}

function formatGreekDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("el-GR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
