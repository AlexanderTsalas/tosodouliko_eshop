"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ customer_id: z.string().uuid() });

/**
 * Delete a customer row. Strict guards:
 *
 *   - Refuses if the customer has ANY orders — order history must be preserved
 *     even after a customer is "removed". To clean up an old customer that
 *     placed orders, the right operation is anonymize (edit name/email/phone
 *     to blank or placeholder values), not delete.
 *   - Refuses if `auth_user_id` is set — auth-linked customers are managed
 *     via the Users tab; deleting here would orphan the linkage.
 *     `addresses` will cascade automatically via FK.
 */
export async function deleteCustomer(
  input: z.input<typeof Schema>
): Promise<Result<{ customer_id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ customer_id: string }>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:orders"))) {
    return fail<{ customer_id: string }>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<{ customer_id: string }>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();

  const { data: customer } = await admin
    .from("customers")
    .select("id, auth_user_id, email")
    .eq("id", parsed.data.customer_id)
    .maybeSingle();

  if (!customer) {
    return fail<{ customer_id: string }>("Customer not found", "NOT_FOUND");
  }
  const c = customer as { id: string; auth_user_id: string | null; email: string | null };

  if (c.auth_user_id !== null) {
    return fail<{ customer_id: string }>(
      "Ο πελάτης είναι συνδεδεμένος με λογαριασμό χρήστη. Διαχειριστείτε από την καρτέλα «Χρήστες».",
      "HAS_AUTH"
    );
  }

  const { count: orderCount } = await admin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", parsed.data.customer_id);

  if ((orderCount ?? 0) > 0) {
    return fail<{ customer_id: string }>(
      `Ο πελάτης έχει ${orderCount} παραγγελίες. Δεν διαγράφεται — επεξεργαστείτε τα στοιχεία αντί για διαγραφή για ανωνυμοποίηση.`,
      "HAS_ORDERS"
    );
  }

  const { error: delErr } = await admin
    .from("customers")
    .delete()
    .eq("id", parsed.data.customer_id);
  if (delErr) return fail<{ customer_id: string }>(delErr.message, delErr.code);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "customer.deleted",
    resource_type: "customer",
    resource_id: parsed.data.customer_id,
    metadata: { email_at_delete: c.email },
  });

  revalidatePath("/admin/customers");
  return ok({ customer_id: parsed.data.customer_id });
}
