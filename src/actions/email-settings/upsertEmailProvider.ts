"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { encryptSecret } from "@/lib/email/encryption";
import { fail, ok, type Result } from "@/types/result";
import type { EmailProviderConfig } from "@/types/email";

const SmtpConfigSchema = z.object({
  host: z.string().min(1).max(200),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().min(1).max(200),
});

const Schema = z.object({
  /** Pass to update an existing row; omit to insert. */
  id: z.string().uuid().optional(),
  kind: z.enum(["smtp", "resend"]),
  display_name: z.string().trim().min(1).max(120),
  from_address: z.string().email(),
  reply_to: z.string().email().nullable().optional(),
  /** Shape varies by kind. */
  config: z.union([SmtpConfigSchema, z.object({ domain: z.string().optional() })]),
  /**
   * Provider secret in plaintext (SMTP password or Resend API key). Optional
   * on update — if absent, we keep the existing ciphertext untouched. Always
   * required on insert (validated below).
   */
  secret: z.string().min(1).max(2000).optional(),
});

export async function upsertEmailProvider(
  input: z.input<typeof Schema>
): Promise<Result<EmailProviderConfig>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<EmailProviderConfig>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:settings"))) {
    return fail<EmailProviderConfig>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<EmailProviderConfig>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  const isInsert = !parsed.data.id;
  if (isInsert && !parsed.data.secret) {
    return fail<EmailProviderConfig>(
      "Συμπληρώστε το password / API key για τον νέο πάροχο.",
      "MISSING_SECRET"
    );
  }

  // Encrypt secret app-side. The DB never sees plaintext.
  let secretBytes: Buffer | undefined;
  if (parsed.data.secret) {
    try {
      secretBytes = encryptSecret(parsed.data.secret);
    } catch (e) {
      return fail<EmailProviderConfig>(
        "Encryption setup error: " + (e as Error).message,
        "CRYPTO_SETUP"
      );
    }
  }

  const basePayload = {
    kind: parsed.data.kind,
    display_name: parsed.data.display_name,
    from_address: parsed.data.from_address,
    reply_to: parsed.data.reply_to ?? null,
    config: parsed.data.config,
    updated_at: new Date().toISOString(),
  };

  let row: EmailProviderConfig | null;
  if (isInsert) {
    const { data, error } = await admin
      .from("email_provider_configs")
      .insert({
        ...basePayload,
        // Bytea: Supabase accepts Buffer here.
        secrets_encrypted: secretBytes,
        created_by: authData.user.id,
      })
      .select("*")
      .single();
    if (error || !data) return fail<EmailProviderConfig>(error?.message ?? "Insert failed", error?.code);
    row = data as EmailProviderConfig;
  } else {
    const update: Record<string, unknown> = { ...basePayload };
    if (secretBytes) update.secrets_encrypted = secretBytes;
    const { data, error } = await admin
      .from("email_provider_configs")
      .update(update)
      .eq("id", parsed.data.id!)
      .select("*")
      .single();
    if (error || !data) return fail<EmailProviderConfig>(error?.message ?? "Update failed", error?.code);
    row = data as EmailProviderConfig;
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: isInsert ? "email_provider.created" : "email_provider.updated",
    resource_type: "email_provider_config",
    resource_id: row.id,
    metadata: {
      kind: row.kind,
      display_name: row.display_name,
      from_address: row.from_address,
      secret_rotated: !!secretBytes && !isInsert,
    },
  });

  revalidatePath("/admin/settings/email");
  return ok(row);
}
