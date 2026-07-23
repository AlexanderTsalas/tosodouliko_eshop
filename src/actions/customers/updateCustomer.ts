"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, concurrentEdit, type Result } from "@/types/result";
import type { Customer } from "@/types/customer";

const Schema = z.object({
  customer_id: z.string().uuid(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  first_name: z.string().max(120).nullable().optional(),
  last_name: z.string().max(120).nullable().optional(),
  preferred_locale: z.string().max(10).optional(),
  preferred_currency: z.string().length(3).optional(),
  marketing_opt_in: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
  /** Optimistic-lock guard from the page that rendered this form. */
  expected_updated_at: z.string().optional(),
});

/**
 * Admin-side customer edit. Touches the descriptive fields only — `source`,
 * `auth_user_id`, and `created_by` are deliberately immutable through this
 * action (linking/merging is a separate Phase-2 concern).
 *
 * Bumps `updated_at` on the row.
 */
export async function updateCustomer(
  input: z.input<typeof Schema>
): Promise<Result<Customer>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<Customer>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:orders"))) {
    return fail<Customer>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<Customer>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.email !== undefined) update.email = parsed.data.email;
  if (parsed.data.phone !== undefined) update.phone = parsed.data.phone;
  if (parsed.data.first_name !== undefined) update.first_name = parsed.data.first_name;
  if (parsed.data.last_name !== undefined) update.last_name = parsed.data.last_name;
  if (parsed.data.preferred_locale) update.preferred_locale = parsed.data.preferred_locale;
  if (parsed.data.preferred_currency)
    update.preferred_currency = parsed.data.preferred_currency;
  if (parsed.data.marketing_opt_in !== undefined)
    update.marketing_opt_in = parsed.data.marketing_opt_in;
  if (parsed.data.notes !== undefined) update.notes = parsed.data.notes;

  // Optimistic-lock UPDATE. When the form passes expected_updated_at,
  // the predicate makes the write conditional on the row not having
  // moved. .maybeSingle() instead of .single() so the no-row-matched
  // case becomes data=null (a clean signal) rather than an error.
  let updateQuery = admin
    .from("customers")
    .update(update)
    .eq("id", parsed.data.customer_id);
  if (parsed.data.expected_updated_at) {
    updateQuery = updateQuery.eq("updated_at", parsed.data.expected_updated_at);
  }
  const { data, error } = await updateQuery.select("*").maybeSingle();

  if (error) return fail<Customer>(error.message, error.code);
  if (!data) {
    // No row matched — either the customer was deleted (unlikely) or
    // the opt-lock predicate failed because someone else moved the row.
    if (parsed.data.expected_updated_at) {
      return concurrentEdit<Customer>();
    }
    return fail<Customer>("Customer not found", "NOT_FOUND");
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "customer.updated",
    resource_type: "customer",
    resource_id: parsed.data.customer_id,
    metadata: { fields: Object.keys(update).filter((k) => k !== "updated_at") },
  });

  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${parsed.data.customer_id}`);
  return ok(data as Customer);
}
