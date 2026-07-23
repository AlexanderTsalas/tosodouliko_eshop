"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { brand } from "@/config/brand";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { dispatch } from "@/lib/email";
import { logAuditEvent } from "@/lib/audit-log";
import { checkRateLimit } from "@/lib/rate-limit";
import { fail, ok, type Result } from "@/types/result";
import type { EmailProviderConfig } from "@/types/email";

const Schema = z.object({
  provider_id: z.string().uuid(),
  to: z.string().email(),
});

/**
 * Sends a small "this is a test" message via the named provider — bypassing
 * the "is_active" check so admins can verify a freshly-saved config before
 * promoting it. Records the result on the row (last_test_at / status /
 * message) so the settings UI can show a green check vs. red error inline.
 */
export async function sendTestEmail(
  input: z.input<typeof Schema>
): Promise<Result<{ provider_message_id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ provider_message_id: string }>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:settings"))) {
    return fail<{ provider_message_id: string }>("Forbidden", "FORBIDDEN");
  }
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<{ provider_message_id: string }>("Not authenticated", "UNAUTHENTICATED");
  }

  // Per-admin throughput cap — test sends hit the configured SMTP / Resend
  // provider, which has its own rate limits and (for paid plans) per-send
  // cost. 10/min/admin is plenty for config debugging.
  const rl = await checkRateLimit({
    key: `email-test:${authData.user.id}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return fail<{ provider_message_id: string }>(
      "Too many test sends — wait a minute and retry",
      "RATE_LIMITED"
    );
  }

  const admin = createAdminClient();
  const { data: provider } = await admin
    .from("email_provider_configs")
    .select("*")
    .eq("id", parsed.data.provider_id)
    .maybeSingle();
  if (!provider) {
    return fail<{ provider_message_id: string }>("Provider not found", "NOT_FOUND");
  }

  try {
    const result = await dispatch(provider as EmailProviderConfig, {
      to: parsed.data.to,
      subject: `✅ Test email — ${brand.name} admin`,
      text: [
        "This is a test message confirming the email provider configuration works.",
        "",
        `Provider:  ${(provider as EmailProviderConfig).display_name}`,
        `Kind:      ${(provider as EmailProviderConfig).kind}`,
        `Sent at:   ${new Date().toISOString()}`,
        "",
        "If you received this, transactional emails will work for order notifications, password resets, and other system messages.",
      ].join("\n"),
    });

    await admin
      .from("email_provider_configs")
      .update({
        last_test_at: new Date().toISOString(),
        last_test_status: "success",
        last_test_message: `Sent to ${parsed.data.to}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", parsed.data.provider_id);

    if (authData.user) {
      await logAuditEvent({
        actor_id: authData.user.id,
        actor_type: "user",
        action: "email_provider.tested",
        resource_type: "email_provider_config",
        resource_id: parsed.data.provider_id,
        metadata: { to: parsed.data.to, status: "success" },
      });
    }
    revalidatePath("/admin/settings/email");
    return ok({ provider_message_id: result.provider_message_id });
  } catch (e) {
    const msg = (e as Error).message ?? "Test send failed";
    await admin
      .from("email_provider_configs")
      .update({
        last_test_at: new Date().toISOString(),
        last_test_status: "failed",
        last_test_message: msg.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", parsed.data.provider_id);
    if (authData.user) {
      await logAuditEvent({
        actor_id: authData.user.id,
        actor_type: "user",
        action: "email_provider.tested",
        resource_type: "email_provider_config",
        resource_id: parsed.data.provider_id,
        metadata: { to: parsed.data.to, status: "failed", error: msg },
      });
    }
    revalidatePath("/admin/settings/email");
    return fail<{ provider_message_id: string }>(msg, "TEST_FAILED");
  }
}
