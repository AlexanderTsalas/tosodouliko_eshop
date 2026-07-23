"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { Customer } from "@/types/customer";

/**
 * Manual merge of two customers.
 *
 *   source → DELETED
 *   target → SURVIVES (receives source's orders + addresses)
 *
 * Used by the admin "Πιθανά διπλότυπα" section on a customer's detail
 * page when the matcher has flagged candidates that aren't quite
 * confident enough to auto-merge. The admin reviews + clicks
 * "Συγχώνευση" on the candidate; that candidate is the SOURCE and
 * gets folded into the customer whose detail page is being viewed
 * (the TARGET).
 *
 * Safety rules:
 *   - source ≠ target (no-op)
 *   - permission: manage:orders
 *   - If source.auth_user_id IS NOT NULL and target.auth_user_id IS NULL,
 *     we REFUSE the merge with a clear error — the admin almost
 *     certainly wants to merge the OTHER way (delete the offline shell,
 *     keep the auth-linked record). They can flip the operation from
 *     the source's page.
 *   - If BOTH have auth_user_id, we also refuse: two distinct logins
 *     cannot be silently collapsed without choosing which session
 *     identity to keep. The admin must resolve that manually (e.g. by
 *     deleting one of the auth users first).
 *
 * Steps (in order):
 *   1. Re-point every orders.customer_id = source.id → target.id
 *   2. Re-point every addresses.customer_id = source.id → target.id
 *   3. Copy any missing contact fields from source to target (e.g. if
 *      source has a phone but target doesn't, target inherits it)
 *   4. Delete the source row
 *   5. Audit log the merge with metadata (counts, source info)
 */
const Schema = z.object({
  source_id: z.string().uuid(),
  target_id: z.string().uuid(),
});

interface MergeResult {
  /** The surviving customer row, with any inherited contact fields applied. */
  customer: Customer;
  /** Number of orders that were re-pointed. */
  orders_moved: number;
  /** Number of addresses that were re-pointed. */
  addresses_moved: number;
}

export async function mergeCustomers(
  input: z.input<typeof Schema>
): Promise<Result<MergeResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<MergeResult>("Invalid input", "INVALID_INPUT");
  }
  if (parsed.data.source_id === parsed.data.target_id) {
    return fail<MergeResult>(
      "Source and target are the same customer.",
      "SAME_ID"
    );
  }
  if (!(await checkPermission("manage:orders"))) {
    return fail<MergeResult>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<MergeResult>("Not authenticated", "UNAUTHENTICATED");
  }

  const admin = createAdminClient();

  // 1. Fetch both customers and validate the auth-link guard.
  const { data: rows, error: fetchErr } = await admin
    .from("customers")
    .select("*")
    .in("id", [parsed.data.source_id, parsed.data.target_id]);
  if (fetchErr || !rows) {
    return fail<MergeResult>(
      fetchErr?.message ?? "Lookup failed",
      "DB_ERROR"
    );
  }
  const list = rows as Customer[];
  const source = list.find((c) => c.id === parsed.data.source_id);
  const target = list.find((c) => c.id === parsed.data.target_id);
  if (!source || !target) {
    return fail<MergeResult>("Customer not found.", "NOT_FOUND");
  }

  // Refuse merges that would destroy an auth-linked identity OR
  // collapse two auth sessions. Both cases require manual resolution.
  if (source.auth_user_id !== null && target.auth_user_id === null) {
    return fail<MergeResult>(
      "Ο επιλεγμένος υποψήφιος έχει συνδεδεμένο λογαριασμό αλλά ο τρέχων πελάτης δεν έχει. " +
        "Πιθανότατα θέλετε να συγχωνεύσετε αντίστροφα — ανοίξτε τη σελίδα του άλλου πελάτη.",
      "AUTH_LINK_GUARD"
    );
  }
  if (source.auth_user_id !== null && target.auth_user_id !== null) {
    return fail<MergeResult>(
      "Και οι δύο πελάτες έχουν συνδεδεμένο λογαριασμό. Πρώτα διαγράψτε έναν από τους χρήστες auth, μετά συγχωνεύστε.",
      "BOTH_AUTH_LINKED"
    );
  }

  // 2. CONTACT FIELD INHERITANCE — patch target before the RPC so the
  // merge_offline_customer call sees the final target shape. The RPC
  // itself only handles the orders + addresses move + source delete; the
  // contact inheritance is admin-specific. Idempotent: only fills empty
  // target fields, so a retry after a partial RPC failure is safe.
  //
  // The "winning" customer should never LOSE info it already had, but
  // should gain anything the duplicate happens to know.
  const patch: Record<string, unknown> = {};
  if (!target.email && source.email) patch.email = source.email;
  if (!target.phone && source.phone) patch.phone = source.phone;
  if (!target.first_name && source.first_name)
    patch.first_name = source.first_name;
  if (!target.last_name && source.last_name) patch.last_name = source.last_name;
  if (Object.keys(patch).length > 0) {
    patch.updated_at = new Date().toISOString();
    const { error: patchErr } = await admin
      .from("customers")
      .update(patch)
      .eq("id", target.id);
    if (patchErr) {
      return fail<MergeResult>(
        `Target contact patch failed: ${patchErr.message}`,
        "DB_ERROR"
      );
    }
  }

  // 3. ATOMIC MERGE via merge_offline_customer RPC. All three writes
  // (orders re-point + addresses re-point + source delete) happen in a
  // single Postgres transaction with an advisory lock to serialize
  // concurrent merges of the same pair.
  //
  // Replaces a 3-step JS sequence that could leave orders moved + source
  // alive if the addresses move failed. The RPC is already used by
  // placeOrder for offline→online merge; admin path now uses the same
  // primitive.
  const { data: mergeRes, error: mergeErr } = await admin.rpc(
    "merge_offline_customer" as never,
    {
      p_source_id: source.id,
      p_target_id: target.id,
    } as never
  );
  if (mergeErr) {
    return fail<MergeResult>(
      `Merge failed: ${mergeErr.message}`,
      mergeErr.code ?? "DB_ERROR"
    );
  }
  const mergeStats = (mergeRes ?? {}) as {
    outcome?: string;
    orders_moved?: number;
    addresses_moved?: number;
  };
  const ordersCount = mergeStats.orders_moved ?? 0;
  const addrCount = mergeStats.addresses_moved ?? 0;

  // 4. Audit log. Stays in JS — same actor + metadata shape as before.
  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "customer.manual_merged",
    resource_type: "customer",
    resource_id: target.id,
    metadata: {
      merged_from: source.id,
      outcome: mergeStats.outcome ?? "merged",
      orders_moved: ordersCount,
      addresses_moved: addrCount,
      source_email: source.email,
      source_phone: source.phone,
      source_name: [source.first_name, source.last_name].filter(Boolean).join(" "),
    },
  });

  // 7. Fetch the final target state to return.
  const { data: finalRow } = await admin
    .from("customers")
    .select("*")
    .eq("id", target.id)
    .maybeSingle();

  // Revalidate the surfaces that touch this customer.
  revalidatePath(`/admin/customers/${target.id}`);
  revalidatePath(`/admin/customers/${source.id}`);
  revalidatePath("/admin/customers");
  revalidatePath("/admin/orders");

  return ok({
    customer: (finalRow ?? target) as Customer,
    orders_moved: ordersCount ?? 0,
    addresses_moved: addrCount ?? 0,
  });
}
