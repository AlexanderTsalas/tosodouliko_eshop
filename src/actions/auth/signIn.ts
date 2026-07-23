"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, checkDistinctRateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const SignInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  /**
   * Honeypot: invisible field in the form. Bots tend to fill all inputs;
   * legitimate users (and their password managers) don't see this one.
   * Any non-empty value fails the action with the same generic error
   * shape a real auth failure produces, so the bot can't distinguish
   * "honeypot tripped" from "wrong credentials".
   */
  company: z.string().max(200).optional(),
});

export async function signIn(input: z.infer<typeof SignInSchema>): Promise<Result<{ userId: string }>> {
  const parsed = SignInSchema.safeParse(input);
  if (!parsed.success) {
    return fail<{ userId: string }>("Invalid email or password", "INVALID_INPUT");
  }

  // Honeypot check: any non-empty value means a bot filled an invisible
  // field. Return the same generic error as a real auth failure so the
  // probe can't distinguish the rejection mechanism.
  if (parsed.data.company && parsed.data.company.trim().length > 0) {
    return fail<{ userId: string }>("Invalid credentials", "AUTH_FAILED");
  }

  const ip = (await headers()).get("x-forwarded-for") ?? "unknown";

  // Per-(IP, email) attempt limit — protects against vertical brute force
  // (one attacker hammering one account).
  const rl = await checkRateLimit({
    key: `signin:${ip}:${parsed.data.email}`,
    limit: 5,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return fail<{ userId: string }>("Too many attempts — try again later", "RATE_LIMITED");
  }

  // Pattern 4: distinct-usernames-per-IP limit — protects against
  // horizontal credential stuffing (one attacker rotating many emails
  // from the same IP). Each new username from the same IP within the
  // window counts toward this cap; repeat attempts on the same email
  // don't (the per-(IP, email) limit above handles those).
  const distinct = await checkDistinctRateLimit({
    key: `signin-emails:${ip}`,
    value: parsed.data.email.toLowerCase().trim(),
    limit: 5,
    windowMs: 5 * 60_000,
  });
  if (!distinct.allowed) {
    await logAuditEvent({
      actor_type: "user",
      action: "auth.signin.credential_stuffing_blocked",
      resource_type: "user",
      resource_id: parsed.data.email,
      ip_address: ip === "unknown" ? null : ip,
    });
    return fail<{ userId: string }>("Too many sign-in attempts — try again later", "RATE_LIMITED");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    await logAuditEvent({
      actor_type: "user",
      action: "auth.signin.failed",
      resource_type: "user",
      resource_id: parsed.data.email,
      ip_address: ip === "unknown" ? null : ip,
    });
    return fail<{ userId: string }>("Invalid credentials", "AUTH_FAILED");
  }

  await logAuditEvent({
    actor_id: data.user.id,
    actor_type: "user",
    action: "auth.signin",
    resource_type: "user",
    resource_id: data.user.id,
    ip_address: ip === "unknown" ? null : ip,
  });

  return ok({ userId: data.user.id });
}
