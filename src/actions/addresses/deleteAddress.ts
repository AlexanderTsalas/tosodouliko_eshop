"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ address_id: z.string().uuid() });

/**
 * Customer-side address delete. Ownership is verified via the caller's
 * customer row (auth_user_id link). Admins with manage:orders can also
 * delete via the admin client, but this action is intended for the
 * customer's own account page.
 *
 * Hard-delete (not soft) — addresses are denormalized snapshots when used
 * on an order (orders.shipping_address jsonb). The order keeps its frozen
 * copy even after the source row is gone, so deletion here is safe.
 */
export async function deleteAddress(
  input: z.input<typeof Schema>
): Promise<Result<{ address_id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ address_id: string }>("Invalid input", "INVALID_INPUT");
  }
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<{ address_id: string }>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  const { data: custRow } = await admin
    .from("customers")
    .select("id")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  const customerId = (custRow as { id: string } | null)?.id ?? null;
  if (!customerId) return fail<{ address_id: string }>("No customer", "NO_CUSTOMER");

  const { data: row } = await admin
    .from("addresses")
    .select("id, customer_id")
    .eq("id", parsed.data.address_id)
    .maybeSingle();
  if (!row) return fail<{ address_id: string }>("Address not found", "NOT_FOUND");
  if ((row as { customer_id: string }).customer_id !== customerId) {
    return fail<{ address_id: string }>("Forbidden", "FORBIDDEN");
  }

  const { error } = await admin
    .from("addresses")
    .delete()
    .eq("id", parsed.data.address_id);
  if (error) return fail<{ address_id: string }>(error.message, error.code);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "address.deleted",
    resource_type: "address",
    resource_id: parsed.data.address_id,
    metadata: { customer_id: customerId },
  });

  revalidatePath("/account/addresses");
  revalidatePath("/checkout");
  return ok({ address_id: parsed.data.address_id });
}
