"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, checkDistinctRateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const SignUpSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Za-z]/, "Password must contain a letter")
    .regex(/[0-9]/, "Password must contain a digit"),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  marketingOptIn: z.boolean().optional(),
  /** Optional return path appended to the email-confirm redirect so the
   *  customer lands back where they came from after verification. */
  next: z.string().optional(),
  /**
   * Honeypot — invisible field in SignupForm. Bots filling all inputs
   * trip this; legitimate users never see it. Any non-empty value fails
   * the action with the generic error a real validation failure produces.
   */
  company: z.string().max(200).optional(),
});

export async function signUp(
  input: z.infer<typeof SignUpSchema>
): Promise<Result<{ userId: string; needsConfirmation: boolean }>> {
  const parsed = SignUpSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Invalid input: " + parsed.error.issues[0].message, "INVALID_INPUT");
  }

  // Honeypot — generic invalid-input error so the bot can't distinguish
  // honeypot rejection from schema validation rejection.
  if (parsed.data.company && parsed.data.company.trim().length > 0) {
    return fail("Invalid input", "INVALID_INPUT");
  }

  // Rate limit per IP — 5 signups/hour. Account-farming defense; a real
  // shop should rarely see one IP creating multiple accounts in an hour.
  const ip = (await headers()).get("x-forwarded-for") ?? "unknown";
  const rl = await checkRateLimit({
    key: `signup:${ip}`,
    limit: 5,
    windowMs: 60 * 60_000,
  });
  if (!rl.allowed) {
    await logAuditEvent({
      actor_type: "user",
      action: "auth.signup.rate_limited",
      resource_type: "user",
      resource_id: parsed.data.email,
      ip_address: ip === "unknown" ? null : ip,
    });
    return fail("Too many sign-up attempts — try again later", "RATE_LIMITED");
  }

  // Email-enumeration defense — limit distinct emails attempted per IP.
  // Catches the "list-walk" pattern: attacker iterates a wordlist of emails
  // to probe which already exist (Supabase's signUp response leaks that
  // signal). 10 distinct emails per IP per hour.
  const distinct = await checkDistinctRateLimit({
    key: `signup-emails:${ip}`,
    value: parsed.data.email.toLowerCase().trim(),
    limit: 10,
    windowMs: 60 * 60_000,
  });
  if (!distinct.allowed) {
    await logAuditEvent({
      actor_type: "user",
      action: "auth.signup.enumeration_blocked",
      resource_type: "user",
      resource_id: parsed.data.email,
      ip_address: ip === "unknown" ? null : ip,
    });
    return fail("Too many sign-up attempts — try again later", "RATE_LIMITED");
  }

  const supabase = await createClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const nextParam = parsed.data.next
    ? `?next=${encodeURIComponent(parsed.data.next)}`
    : "";

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback${nextParam}`,
      data: {
        first_name: parsed.data.firstName,
        last_name: parsed.data.lastName,
        marketing_opt_in: parsed.data.marketingOptIn ?? false,
      },
    },
  });

  if (error || !data.user) {
    return fail("Sign-up failed: " + (error?.message ?? "unknown"), "SIGNUP_FAILED");
  }

  await logAuditEvent({
    actor_id: data.user.id,
    actor_type: "user",
    action: "auth.signup",
    resource_type: "user",
    resource_id: data.user.id,
    metadata: { email: parsed.data.email },
  });

  // The handle_new_user trigger creates user_profiles row + assigns customer role.
  return ok({ userId: data.user.id, needsConfirmation: !data.session });
}
