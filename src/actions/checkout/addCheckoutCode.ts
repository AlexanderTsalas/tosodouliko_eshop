"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type Result } from "@/types/result";
import { checkRateLimit, checkDistinctRateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit-log";

const Schema = z.object({
  session_id: z.string().uuid(),
  code: z.string().min(1).max(64),
});

/**
 * Adds a code to the customer's active cart_checkout_session.
 *
 * Validation:
 *   - The code must exist in rule_codes with active=true
 *   - If the code has a customer whitelist (via rule_code_customers),
 *     the customer must be on it
 *   - The code text is normalized to UPPERCASE (matches the storage)
 *   - Brute-force rate-limit: 10 attempts / hour per customer,
 *     5 distinct codes / hour
 *
 * The actual engine evaluation happens at placeOrder time. This action
 * just records the customer's intent — "I want this code applied."
 */
export async function addCheckoutCode(
  input: z.input<typeof Schema>
): Promise<Result<{ session_id: string; applied_codes: string[] }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail("Not authenticated", "UNAUTHENTICATED");
  const userId = authData.user.id;

  // Rate limits — mirror the legacy applyDiscount pattern.
  const rl = await checkRateLimit({
    key: `offer-apply:${userId}`,
    limit: 10,
    windowMs: 60 * 60_000,
  });
  if (!rl.allowed) {
    return fail("Πολλές προσπάθειες — δοκιμάστε ξανά αργότερα.", "RATE_LIMITED");
  }
  const distinct = await checkDistinctRateLimit({
    key: `offer-codes:${userId}`,
    value: parsed.data.code.toUpperCase().trim(),
    limit: 5,
    windowMs: 60 * 60_000,
  });
  if (!distinct.allowed) {
    await logAuditEvent({
      actor_id: userId,
      actor_type: "user",
      action: "offer.code_brute_force_blocked",
      resource_type: "offer_code",
      resource_id: parsed.data.code,
    });
    return fail(
      "Πολλές διαφορετικές προσπάθειες — δοκιμάστε ξανά αργότερα.",
      "RATE_LIMITED"
    );
  }

  const admin = createAdminClient();
  const codeText = parsed.data.code.toUpperCase().trim();

  // v2.5: codes are globally UNIQUE — at most one row matches.
  const { data: codeRow, error: codeErr } = await admin
    .from("codes")
    .select("id")
    .eq("code", codeText)
    .eq("active", true)
    .maybeSingle();
  if (codeErr) return fail(codeErr.message, codeErr.code);
  if (!codeRow) {
    return fail("Άκυρος κωδικός προσφοράς.", "INVALID_CODE");
  }
  const matchedCodeId = (codeRow as { id: string }).id;

  const { data: customerRow } = await admin
    .from("customers")
    .select("id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  const customerId = (customerRow as { id: string } | null)?.id ?? null;

  // Customer whitelist gate — if any whitelist row exists for this code,
  // the customer must be on it.
  const { data: whitelistRows } = await admin
    .from("code_customers")
    .select("customer_id")
    .eq("code_id", matchedCodeId);
  const whitelist = (
    (whitelistRows ?? []) as Array<{ customer_id: string }>
  ).map((r) => r.customer_id);
  const accessible =
    whitelist.length === 0 ||
    (customerId !== null && whitelist.includes(customerId));
  if (!accessible) {
    return fail(
      "Ο κωδικός δεν είναι διαθέσιμος για τον λογαριασμό σας.",
      "CODE_RESTRICTED"
    );
  }

  // Read the current applied_codes, dedupe, and write back.
  const { data: sessionRow, error: sErr } = await admin
    .from("cart_checkout_sessions")
    .select("applied_codes, customer_id")
    .eq("id", parsed.data.session_id)
    .maybeSingle();
  if (sErr) return fail(sErr.message, sErr.code);
  if (!sessionRow) return fail("Checkout session not found", "NOT_FOUND");

  // Ownership check
  if (customerId === null || (sessionRow as { customer_id: string }).customer_id !== customerId) {
    return fail("Forbidden", "FORBIDDEN");
  }

  const existing = ((sessionRow as { applied_codes: string[] }).applied_codes ?? []) as string[];
  if (existing.includes(codeText)) {
    return ok({ session_id: parsed.data.session_id, applied_codes: existing });
  }
  const next = [...existing, codeText];

  const { error: updErr } = await admin
    .from("cart_checkout_sessions")
    .update({ applied_codes: next })
    .eq("id", parsed.data.session_id);
  if (updErr) return fail(updErr.message, updErr.code);

  revalidatePath("/checkout");
  return ok({ session_id: parsed.data.session_id, applied_codes: next });
}
