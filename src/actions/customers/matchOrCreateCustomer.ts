"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import { normalizeEmail, normalizePhone } from "@/lib/customers/normalize";
import { findCustomerMatches } from "@/lib/customers/matchSignals";
import type { Customer, CustomerSource } from "@/types/customer";

const Schema = z.object({
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  first_name: z.string().max(120).optional(),
  last_name: z.string().max(120).optional(),
  source: z.enum(["eshop_signup", "admin_manual", "phone", "in_store"]).default("admin_manual"),
  /**
   * When true, the action returns any strict (email AND phone) match without
   * creating a new customer. The caller then prompts the operator/user with
   * "Είστε εσείς?" and re-calls with `accept_match: true` or
   * `create_new: true`. When false (default), the action creates a new
   * customer regardless — used by background flows that don't need dedup.
   */
  prompt_on_match: z.boolean().default(true),
  /** Caller confirmed the match — attach to it. Skips the match query. */
  accept_match_id: z.string().uuid().optional(),
  /** Caller rejected the match — force a fresh customer even on collision. */
  force_new: z.boolean().default(false),
});

export type CustomerMatchOutcome =
  | { outcome: "matched"; customer: Customer; needs_confirmation: boolean }
  | { outcome: "created"; customer: Customer };

/**
 * The single entry point used by order-creation flows (manual + eventual
 * eshop checkout) to attach an order to a customer.
 *
 * Strict matching rule (both fields, both normalized) — see the design notes
 * in supabase/migrations/.../customers_entity.sql and src/lib/customers/normalize.ts.
 * Single-field collisions are NOT treated as matches; the caller will land
 * with a brand-new customer in those cases, and an admin can merge later.
 *
 * Returns:
 *   - `{ outcome: 'matched', customer, needs_confirmation: true }` when a
 *     strict match exists and the caller asked us to prompt — the UI should
 *     show "Είστε εσείς?" and re-invoke with `accept_match_id` or
 *     `force_new: true`.
 *   - `{ outcome: 'matched', customer, needs_confirmation: false }` when the
 *     caller passed `accept_match_id` and we attached.
 *   - `{ outcome: 'created', customer }` in every other case.
 */
export async function matchOrCreateCustomer(
  input: z.input<typeof Schema>
): Promise<Result<CustomerMatchOutcome>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<CustomerMatchOutcome>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:orders"))) {
    return fail<CustomerMatchOutcome>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  const admin = createAdminClient();

  // 1. Explicit accept — caller already saw the match and confirmed it.
  if (parsed.data.accept_match_id) {
    const { data: existing, error: fetchErr } = await admin
      .from("customers")
      .select("*")
      .eq("id", parsed.data.accept_match_id)
      .maybeSingle();
    if (fetchErr || !existing) {
      return fail<CustomerMatchOutcome>("Match no longer exists", "MATCH_GONE");
    }
    return ok({
      outcome: "matched",
      customer: existing as Customer,
      needs_confirmation: false,
    });
  }

  const emailNorm = normalizeEmail(parsed.data.email);
  const phoneNorm = normalizePhone(parsed.data.phone);

  // 2. Weighted dedup lookup — see findCustomerMatches for the signal
  // table. Replaces the old strict email-AND-phone rule, which missed the
  // common case of an admin offline customer (no email yet) colliding
  // with the same person's later eshop signup (new email + same phone +
  // same name).
  //
  // Match tiers:
  //   HIGH   → auto-attach (silent for prompt_on_match=false), prompt
  //            otherwise. Examples: email match, OR phone+name match.
  //   MEDIUM → always prompt — too much ambiguity for silent attach.
  //            Examples: phone alone, email+weak.
  //   LOW    → ignored here (covered by admin merge tools later).
  //
  // force_new still short-circuits the lookup entirely.
  if (!parsed.data.force_new && (emailNorm || phoneNorm)) {
    const matches = await findCustomerMatches(admin, {
      email: parsed.data.email,
      phone: parsed.data.phone,
      first_name: parsed.data.first_name,
      last_name: parsed.data.last_name,
    });
    const meaningful = matches.filter(
      (m) => m.confidence === "high" || m.confidence === "medium"
    );
    if (meaningful.length > 0) {
      const top = meaningful[0];
      // HIGH-confidence + caller doesn't want a prompt → silent attach.
      if (!parsed.data.prompt_on_match && top.confidence === "high") {
        return ok({
          outcome: "matched",
          customer: top.customer,
          needs_confirmation: false,
        });
      }
      // Otherwise (medium-confidence always, or high+prompt=true), return
      // the match and let the UI confirm via accept_match_id / force_new.
      return ok({
        outcome: "matched",
        customer: top.customer,
        needs_confirmation: true,
      });
    }
  }

  // 3. No match (or no dedup possible) — create a new customer.
  const payload: Partial<Customer> & { source: CustomerSource } = {
    email: parsed.data.email ?? null,
    phone: parsed.data.phone ?? null,
    first_name: parsed.data.first_name ?? null,
    last_name: parsed.data.last_name ?? null,
    source: parsed.data.source,
    created_by: authData.user?.id ?? null,
  };

  const { data: created, error: createErr } = await admin
    .from("customers")
    .insert(payload)
    .select("*")
    .single();
  if (createErr || !created) {
    return fail<CustomerMatchOutcome>(
      createErr?.message ?? "Could not create customer",
      createErr?.code
    );
  }

  await logAuditEvent({
    actor_id: authData.user?.id ?? null,
    actor_type: "user",
    action: "customer.created",
    resource_type: "customer",
    resource_id: (created as Customer).id,
    metadata: {
      source: parsed.data.source,
      had_email: Boolean(emailNorm),
      had_phone: Boolean(phoneNorm),
      forced_new: parsed.data.force_new,
    },
  });

  return ok({ outcome: "created", customer: created as Customer });
}
