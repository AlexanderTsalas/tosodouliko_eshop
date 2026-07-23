export type EmailProviderKind = "smtp" | "resend";

/**
 * Persisted shape of a configured email provider. `config` and
 * `secrets_encrypted` shapes vary by `kind` — see {@link SmtpConfig} and
 * {@link ResendConfig} for the non-secret pieces.
 */
export interface EmailProviderConfig {
  id: string;
  kind: EmailProviderKind;
  display_name: string;
  from_address: string;
  reply_to: string | null;
  config: SmtpConfig | ResendConfig | Record<string, never>;
  /** Bytea ciphertext (IV || ciphertext || GCM tag). Decrypted at send time. */
  secrets_encrypted: string | Uint8Array | null;
  is_active: boolean;
  last_test_at: string | null;
  last_test_status: string | null;
  last_test_message: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  /** true → TLS on connect (port 465); false → STARTTLS upgrade (port 587). */
  secure: boolean;
  username: string;
  // Password lives in secrets_encrypted, never in config.
}

export interface ResendConfig {
  /** Optional — pin the sender domain for the account. */
  domain?: string;
  // API key lives in secrets_encrypted.
}

/**
 * Common shape every provider implementation produces from a render +
 * accepts at send time.
 */
export interface OutgoingEmail {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export interface SendResult {
  provider_message_id: string;
}
