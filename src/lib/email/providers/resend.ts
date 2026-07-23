import { Resend } from "resend";
import type { OutgoingEmail, SendResult } from "@/types/email";

/**
 * Resend transactional provider. The API key is the decrypted secret.
 * `from` must be on a verified domain in the Resend account (or the default
 * `onboarding@resend.dev` for early testing).
 */
export async function sendViaResend(args: {
  apiKey: string;
  from: string;
  replyTo: string | null;
  message: OutgoingEmail;
}): Promise<SendResult> {
  const resend = new Resend(args.apiKey);
  const { data, error } = await resend.emails.send({
    from: args.from,
    to: args.message.to,
    replyTo: args.replyTo ?? undefined,
    subject: args.message.subject,
    text: args.message.text ?? "",
    html: args.message.html,
  });
  if (error) {
    throw new Error(`Resend: ${error.message}`);
  }
  if (!data?.id) {
    throw new Error("Resend returned no message id");
  }
  return { provider_message_id: data.id };
}
