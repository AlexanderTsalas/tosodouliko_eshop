"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ id: z.string().uuid() });

/**
 * Transitions a draft to 'placed'. After this point the order moves to the
 * Tracking tab and individual line edits go through the manual flow.
 * Refuses if the order has zero lines.
 */
export async function placeOrder(
  input: z.input<typeof Schema>
): Promise<Result<{ id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<{ id: string }>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:suppliers"))) {
    return fail<{ id: string }>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  const { data: order } = await supabase
    .from("supply_orders")
    .select("status")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (!order) return fail<{ id: string }>("Order not found", "NOT_FOUND");
  if ((order as { status: string }).status !== "draft") {
    return fail<{ id: string }>(
      "Order is not in draft state and cannot be placed.",
      "WRONG_STATUS"
    );
  }

  const { count: lineCount } = await supabase
    .from("supply_order_lines")
    .select("id", { count: "exact", head: true })
    .eq("supply_order_id", parsed.data.id);
  if ((lineCount ?? 0) === 0) {
    return fail<{ id: string }>("Cannot place an empty order.", "EMPTY_ORDER");
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("supply_orders")
    .update({ status: "placed", placed_at: now, updated_at: now })
    .eq("id", parsed.data.id);
  if (error) return fail<{ id: string }>(error.message, error.code);

  if (authData.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "supply_order.placed",
      resource_type: "supply_order",
      resource_id: parsed.data.id,
    });
  }

  revalidatePath("/admin/supply-orders");
  revalidatePath("/admin/inventory");
  return ok({ id: parsed.data.id });
}
