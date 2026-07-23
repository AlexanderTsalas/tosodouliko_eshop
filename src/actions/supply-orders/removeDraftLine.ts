"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({ lineId: z.string().uuid() });

/**
 * Removes a line from a draft. If the line was the only one on the draft,
 * the empty draft is also deleted so it doesn't linger in the workspace
 * tab strip.
 */
export async function removeDraftLine(
  input: z.input<typeof Schema>
): Promise<Result<{ supply_order_id: string; draft_deleted: boolean }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ supply_order_id: string; draft_deleted: boolean }>(
      "Invalid input",
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:suppliers"))) {
    return fail<{ supply_order_id: string; draft_deleted: boolean }>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();

  // Confirm we're acting on a draft line and capture the parent id.
  const { data: lineRow } = await supabase
    .from("supply_order_lines")
    .select("supply_order_id, supply_orders(status)")
    .eq("id", parsed.data.lineId)
    .maybeSingle();
  const line = lineRow as {
    supply_order_id: string;
    supply_orders: { status: string } | { status: string }[] | null;
  } | null;
  if (!line) {
    return fail<{ supply_order_id: string; draft_deleted: boolean }>("Line not found", "NOT_FOUND");
  }
  const so = Array.isArray(line.supply_orders) ? line.supply_orders[0] : line.supply_orders;
  if (so?.status !== "draft") {
    return fail<{ supply_order_id: string; draft_deleted: boolean }>(
      "Cannot remove — parent order is not in draft state.",
      "WRONG_STATUS"
    );
  }

  const supplyOrderId = line.supply_order_id;

  const { error } = await supabase
    .from("supply_order_lines")
    .delete()
    .eq("id", parsed.data.lineId);
  if (error) {
    return fail<{ supply_order_id: string; draft_deleted: boolean }>(error.message, error.code);
  }

  // If the draft is now empty, delete it.
  const { count } = await supabase
    .from("supply_order_lines")
    .select("id", { count: "exact", head: true })
    .eq("supply_order_id", supplyOrderId);

  let draftDeleted = false;
  if ((count ?? 0) === 0) {
    await supabase.from("supply_orders").delete().eq("id", supplyOrderId);
    draftDeleted = true;
  }

  revalidatePath("/admin/supply-orders");
  revalidatePath("/admin/inventory");
  return ok({ supply_order_id: supplyOrderId, draft_deleted: draftDeleted });
}
