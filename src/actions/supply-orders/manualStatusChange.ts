"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  id: z.string().uuid(),
  status: z.enum(["draft", "placed", "received", "cancelled"]),
});

/**
 * Escape hatch — admin can force any status transition for edge cases
 * (status drifted, supplier cancelled by phone, sync glitch, etc.).
 *
 * Does NOT run the receipt-side effects (no stock increment, no purchase_lots
 * insert) — if you need those, use the receipt workflow instead. This is
 * purely a status flip with an audit entry.
 */
export async function manualStatusChange(
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
  const oldStatus = (order as { status: string }).status;
  if (oldStatus === parsed.data.status) return ok({ id: parsed.data.id });

  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    status: parsed.data.status,
    updated_at: now,
  };
  if (parsed.data.status === "placed") update.placed_at = now;
  if (parsed.data.status === "received") update.received_at = now;

  const { error } = await supabase
    .from("supply_orders")
    .update(update)
    .eq("id", parsed.data.id);
  if (error) return fail<{ id: string }>(error.message, error.code);

  if (authData.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "supply_order.status_forced",
      resource_type: "supply_order",
      resource_id: parsed.data.id,
      metadata: { from: oldStatus, to: parsed.data.status },
    });
  }

  revalidatePath("/admin/supply-orders");
  revalidatePath("/admin/inventory");
  return ok({ id: parsed.data.id });
}
