import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type Result } from "@/types/result";
import type {
  EmailProviderConfig,
  OutgoingEmail,
  ResendConfig,
  SendResult,
  SmtpConfig,
} from "@/types/email";
import { bytesFromSupabase, decryptSecret } from "./encryption";
import { sendViaSmtp } from "./providers/smtp";
import { sendViaResend } from "./providers/resend";
import { shouldSuppressDuplicate } from "./sendDedup";

/**
 * Public input shape — preserved from the previous stub so existing callers
 * (transitionOrderStatus, fulfillOrder, etc.) keep compiling untouched.
 * `templateId` is currently informational only; templates render into
 * subject/text/html app-side and are passed through here.
 */
export interface SendEmailInput {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  templateId?: string;
  templateData?: Record<string, unknown>;
}

/**
 * Single transactional email entry point. Reads the currently-active
 * provider config from the DB, decrypts the secret, dispatches.
 *
 * Behavior when no active provider is configured: logs to the server console
 * and returns ok() with a `dev-` message id, exactly like the previous stub.
 * This keeps non-prod environments working without admin config and ensures
 * the production order flow doesn't hard-fail just because email isn't set
 * up yet — failures here should never block an order.
 */
export async function sendEmail(
  input: SendEmailInput
): Promise<Result<SendResult>> {
  if (!input.to || !input.subject) {
    return fail<SendResult>("Missing to/subject", "INVALID_INPUT");
  }

  // Suppress identical (to, templateId) sends within 5 min. Untemplated
  // sends (no templateId) are passed through — those callers haven't
  // adopted the dedup convention yet.
  if (shouldSuppressDuplicate(input.to, input.templateId)) {
    if (process.env.NODE_ENV !== "production") {
      console.info("[email:dedup-suppressed]", {
        to: input.to,
        templateId: input.templateId,
      });
    }
    return ok({ provider_message_id: `dedup-${Date.now()}` });
  }

  const active = await loadActiveProvider();
  if (!active) {
    if (process.env.NODE_ENV !== "production") {
      console.info("[email:no-provider]", {
        to: input.to,
        subject: input.subject,
        templateId: input.templateId,
      });
    } else {
      console.warn(
        "[email] No active provider configured — skipping send.",
        { to: input.to, subject: input.subject }
      );
    }
    return ok({ provider_message_id: `noop-${Date.now()}` });
  }

  const message: OutgoingEmail = {
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  };

  try {
    const result = await dispatch(active, message);
    return ok(result);
  } catch (err) {
    const msg = (err as Error).message ?? "Email send failed";
    console.error("[email] send failed via", active.kind, ":", msg);
    return fail<SendResult>(msg, "EMAIL_SEND_FAILED");
  }
}

/**
 * Fetch the single active provider config, or null if none. Uses the admin
 * client because email-send happens from system contexts (webhooks, server
 * actions, etc.) where there is no auth.uid() to satisfy RLS.
 */
export async function loadActiveProvider(): Promise<EmailProviderConfig | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_provider_configs")
    .select("*")
    .eq("is_active", true)
    .maybeSingle();
  if (error) {
    console.error("[email] loadActiveProvider failed:", error.message);
    return null;
  }
  return (data as EmailProviderConfig | null) ?? null;
}

/**
 * Dispatch a single email to the configured provider. Exported so the
 * "send test email" admin action can reuse the same code path before the
 * row is marked active (e.g., test a new config without disabling the
 * current one).
 */
export async function dispatch(
  provider: EmailProviderConfig,
  message: OutgoingEmail
): Promise<SendResult> {
  const secretBytes = bytesFromSupabase(provider.secrets_encrypted);
  if (!secretBytes) {
    throw new Error("Provider has no stored credential — open the settings page to save one.");
  }
  const secret = decryptSecret(secretBytes);

  if (provider.kind === "smtp") {
    return sendViaSmtp({
      config: provider.config as SmtpConfig,
      password: secret,
      from: provider.from_address,
      replyTo: provider.reply_to,
      message,
    });
  }
  if (provider.kind === "resend") {
    void (provider.config as ResendConfig); // shape only, no runtime use today
    return sendViaResend({
      apiKey: secret,
      from: provider.from_address,
      replyTo: provider.reply_to,
      message,
    });
  }
  throw new Error(`Unknown provider kind: ${(provider as { kind: string }).kind}`);
}
