"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  lineId: z.string().uuid(),
  orderedQty: z.number().int().positive().optional(),
  unitCost: z.number().nonnegative().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

/**
 * Edits a single draft line. Only allowed while the parent order is still in
 * draft state — once placed, line edits go through the manual status flow.
 */
export async function updateDraftLine(
  input: z.input<typeof Schema>
): Promise<Result<{ id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<{ id: string }>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:suppliers"))) {
    return fail<{ id: string }>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();

  // Refuse if the parent order is not in draft state.
  const { data: lineRow } = await supabase
    .from("supply_order_lines")
    .select("supply_order_id, supply_orders(status)")
    .eq("id", parsed.data.lineId)
    .maybeSingle();
  const line = lineRow as {
    supply_order_id: string;
    supply_orders: { status: string } | { status: string }[] | null;
  } | null;
  if (!line) return fail<{ id: string }>("Line not found", "NOT_FOUND");
  const so = Array.isArray(line.supply_orders) ? line.supply_orders[0] : line.supply_orders;
  if (so?.status !== "draft") {
    return fail<{ id: string }>(
      "Line cannot be edited — parent order is not in draft state.",
      "WRONG_STATUS"
    );
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.orderedQty !== undefined) update.ordered_qty = parsed.data.orderedQty;
  if (parsed.data.unitCost !== undefined) update.unit_cost = parsed.data.unitCost;
  if (parsed.data.notes !== undefined) update.notes = parsed.data.notes;

  const { error } = await supabase
    .from("supply_order_lines")
    .update(update)
    .eq("id", parsed.data.lineId);
  if (error) return fail<{ id: string }>(error.message, error.code);

  revalidatePath("/admin/supply-orders");
  return ok({ id: parsed.data.lineId });
}
