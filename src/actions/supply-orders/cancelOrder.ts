"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  id: z.string().uuid(),
  reason: z.string().max(2000).optional(),
});

/**
 * Cancels a draft or placed order. Received orders are terminal — cannot be
 * cancelled (admin would need to do a manual stock adjustment instead).
 * Cancellation has no inventory or cost-history effect.
 */
export async function cancelOrder(
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
  const status = (order as { status: string }).status;
  if (status === "received") {
    return fail<{ id: string }>(
      "A received order cannot be cancelled. Adjust inventory manually if needed.",
      "TERMINAL"
    );
  }
  if (status === "cancelled") {
    return ok({ id: parsed.data.id });
  }

  const now = new Date().toISOString();
  const update: Record<string, unknown> = { status: "cancelled", updated_at: now };
  if (parsed.data.reason) {
    update.notes = `[cancelled] ${parsed.data.reason}`;
  }
  const { error } = await supabase
    .from("supply_orders")
    .update(update)
    .eq("id", parsed.data.id);
  if (error) return fail<{ id: string }>(error.message, error.code);

  if (authData.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "supply_order.cancelled",
      resource_type: "supply_order",
      resource_id: parsed.data.id,
      metadata: parsed.data.reason ? { reason: parsed.data.reason } : undefined,
    });
  }

  revalidatePath("/admin/supply-orders");
  revalidatePath("/admin/inventory");
  return ok({ id: parsed.data.id });
}
