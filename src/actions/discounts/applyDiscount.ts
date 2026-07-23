"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateDiscount } from "@/lib/discounts";
import { checkRateLimit, checkDistinctRateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { ValidatedDiscount } from "@/types/discount-engine";

const ApplySchema = z.object({
  code: z.string().min(1).max(64),
  subtotal: z.number().nonnegative(),
});

/**
 * Validate a discount code, atomically increment its usage_count, and record
 * the usage. Caller is responsible for storing discount association on the
 * cart/order.
 */
export async function applyDiscount(
  input: z.infer<typeof ApplySchema>
): Promise<Result<ValidatedDiscount>> {
  const parsed = ApplySchema.safeParse(input);
  if (!parsed.success) return fail<ValidatedDiscount>("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<ValidatedDiscount>("Not authenticated", "UNAUTHENTICATED");
  const userId = authData.user.id;

  // Per-user attempt cap — 10 discount attempts per hour. A legitimate
  // customer applying a known code does it once. This caps brute-force
  // attempts to a manageable rate while keeping retry headroom.
  const rl = await checkRateLimit({
    key: `discount-apply:${userId}`,
    limit: 10,
    windowMs: 60 * 60_000,
  });
  if (!rl.allowed) {
    return fail<ValidatedDiscount>(
      "Πολλές προσπάθειες — δοκιμάστε ξανά αργότερα.",
      "RATE_LIMITED"
    );
  }

  // Brute-force defense: count distinct codes tried per user. Catches the
  // attacker iterating a wordlist — 5 distinct unknown codes triggers
  // lockout. Legitimate customers rarely try more than 2-3 codes.
  const distinct = await checkDistinctRateLimit({
    key: `discount-codes:${userId}`,
    value: parsed.data.code.toUpperCase().trim(),
    limit: 5,
    windowMs: 60 * 60_000,
  });
  if (!distinct.allowed) {
    await logAuditEvent({
      actor_id: userId,
      actor_type: "user",
      action: "discount.brute_force_blocked",
      resource_type: "discount_code",
      resource_id: parsed.data.code,
    });
    return fail<ValidatedDiscount>(
      "Πολλές διαφορετικές προσπάθειες — δοκιμάστε ξανά αργότερα.",
      "RATE_LIMITED"
    );
  }

  const validated = await validateDiscount(parsed.data.code, parsed.data.subtotal);
  if (!validated.success) return validated;

  // Atomic increment via admin client (RLS allows public SELECT but write is admin-only).
  const admin = createAdminClient();
  const { error: incErr } = await admin
    .from("discount_codes")
    .update({ usage_count: validated.data.code.usage_count + 1 })
    .eq("id", validated.data.code.id)
    .eq("usage_count", validated.data.code.usage_count); // optimistic concurrency

  if (incErr) return fail<ValidatedDiscount>("Race on usage_count — retry", "RACE");

  await admin.from("discount_usage").insert({
    discount_id: validated.data.code.id,
    user_id: authData.user.id,
    amount_applied: validated.data.amountOff,
  });

  return ok(validated.data);
}
