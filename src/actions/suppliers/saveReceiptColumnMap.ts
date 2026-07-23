"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  supplierId: z.string().uuid(),
  /** Maps a standard field name to the supplier's column header. */
  map: z.object({
    supplier_sku: z.string().optional(),
    quantity: z.string().optional(),
    unit_cost: z.string().optional(),
  }),
});

/**
 * Persists the supplier's CSV column mapping so subsequent receipts skip the
 * mapping step. Stored on suppliers.receipt_column_map as jsonb.
 */
export async function saveReceiptColumnMap(
  input: z.input<typeof Schema>
): Promise<Result<{ id: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<{ id: string }>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:suppliers"))) {
    return fail<{ id: string }>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("suppliers")
    .update({ receipt_column_map: parsed.data.map, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.supplierId);
  if (error) return fail<{ id: string }>(error.message, error.code);

  revalidatePath("/admin/supply-orders");
  return ok({ id: parsed.data.supplierId });
}
