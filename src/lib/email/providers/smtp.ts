import nodemailer from "nodemailer";
import type { OutgoingEmail, SendResult, SmtpConfig } from "@/types/email";

/**
 * SMTP provider — handles Gmail (smtp.gmail.com:587 with App Password),
 * Microsoft 365, custom servers, etc. The "password" is the decrypted
 * secret string read from the DB at send time.
 */
export async function sendViaSmtp(args: {
  config: SmtpConfig;
  password: string;
  from: string;
  replyTo: string | null;
  message: OutgoingEmail;
}): Promise<SendResult> {
  const transport = nodemailer.createTransport({
    host: args.config.host,
    port: args.config.port,
    secure: args.config.secure,
    auth: {
      user: args.config.username,
      pass: args.password,
    },
  });

  const info = await transport.sendMail({
    from: args.from,
    replyTo: args.replyTo ?? undefined,
    to: args.message.to,
    subject: args.message.subject,
    text: args.message.text,
    html: args.message.html,
  });

  // Nodemailer's messageId is provider-assigned and unique enough for our use.
  return { provider_message_id: info.messageId };
}

/**
 * Lightweight credential check — establishes the SMTP connection and authenticates,
 * but does not send a message. Used by the admin's "test config" button to give
 * fast feedback without spamming the admin's own inbox if they only care about
 * verifying creds.
 */
export async function verifySmtpConnection(args: {
  config: SmtpConfig;
  password: string;
}): Promise<void> {
  const transport = nodemailer.createTransport({
    host: args.config.host,
    port: args.config.port,
    secure: args.config.secure,
    auth: { user: args.config.username, pass: args.password },
  });
  await transport.verify();
}
