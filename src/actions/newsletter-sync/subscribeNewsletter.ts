"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/transactional-emails";
import { checkRateLimit, checkDistinctRateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  email: z.string().email(),
  userId: z.string().uuid().optional(),
  /** Honeypot — invisible field on the newsletter form. */
  company: z.string().max(200).optional(),
});

export async function subscribeNewsletter(
  input: z.input<typeof Schema>
): Promise<Result<{ subscribed: boolean }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<{ subscribed: boolean }>("Invalid email", "INVALID_INPUT");

  // Honeypot — return generic success without persisting so bots can't
  // distinguish honeypot rejection from a real subscribe.
  if (parsed.data.company && parsed.data.company.trim().length > 0) {
    return ok({ subscribed: true });
  }

  const ip = (await headers()).get("x-forwarded-for") ?? "unknown";

  // Per-IP throughput cap — 5 subscriptions per IP per hour is well above
  // any legitimate use (household / café signing up multiple people).
  const rl = await checkRateLimit({
    key: `newsletter-subscribe:${ip}`,
    limit: 5,
    windowMs: 60 * 60_000,
  });
  if (!rl.allowed) {
    return fail<{ subscribed: boolean }>(
      "Πολλές προσπάθειες — δοκιμάστε ξανά αργότερα.",
      "RATE_LIMITED"
    );
  }

  // Email-as-spam-target defense — limit distinct emails per IP. An
  // attacker can't use this endpoint to mass-mail welcome emails to
  // arbitrary addresses unless they spread across many IPs.
  const distinct = await checkDistinctRateLimit({
    key: `newsletter-emails:${ip}`,
    value: parsed.data.email.toLowerCase().trim(),
    limit: 10,
    windowMs: 60 * 60_000,
  });
  if (!distinct.allowed) {
    await logAuditEvent({
      actor_type: "system",
      action: "newsletter.subscribe.enumeration_blocked",
      resource_type: "newsletter_subscribers",
      resource_id: parsed.data.email,
      ip_address: ip === "unknown" ? null : ip,
    });
    return fail<{ subscribed: boolean }>(
      "Πολλές προσπάθειες — δοκιμάστε ξανά αργότερα.",
      "RATE_LIMITED"
    );
  }

  const admin = createAdminClient();

  // Don't re-send welcome email on duplicate subscribe / re-subscribe.
  const { data: existing } = await admin
    .from("newsletter_subscribers")
    .select("status")
    .eq("email", parsed.data.email)
    .maybeSingle();
  const isNewOrResubscribing =
    !existing ||
    (existing as { status: string } | null)?.status !== "subscribed";

  const { error } = await admin
    .from("newsletter_subscribers")
    .upsert(
      {
        email: parsed.data.email,
        user_id: parsed.data.userId ?? null,
        status: "subscribed",
        consent_at: new Date().toISOString(),
        unsubscribed_at: null,
      },
      { onConflict: "email" }
    );

  if (error) return fail<{ subscribed: boolean }>(error.message, error.code);

  if (isNewOrResubscribing) {
    await sendEmail({
      to: parsed.data.email,
      subject: "Καλωσορίσατε στο newsletter μας!",
      text: "Σας ευχαριστούμε για την εγγραφή σας.",
      templateId: "newsletter.welcome",
    });
  }

  await logAuditEvent({
    actor_id: parsed.data.userId ?? null,
    actor_type: parsed.data.userId ? "user" : "system",
    action: "newsletter.subscribed",
    resource_type: "newsletter_subscribers",
    resource_id: parsed.data.email,
    ip_address: ip === "unknown" ? null : ip,
    metadata: { is_new_or_resubscribe: isNewOrResubscribing },
  });

  return ok({ subscribed: true });
}
