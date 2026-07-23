"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  association_id: z.string().uuid(),
  /** Full new order — array of pick row ids in the desired sequence.
   *  The server applies sort_order = index for each id. Any rows not
   *  in this array are left untouched. */
  ordered_ids: z.array(z.string().uuid()).min(1),
});

/**
 * Bulk reorder of manual picks for one association. The client sends
 * the full new order; the server applies sort_order = index for each
 * row in turn.
 *
 * Implementation: one UPDATE per id, all in a single transition. For
 * the typical pick count (≤ 24 by max_results), this is fine. If we
 * later need bulk performance, swap to a `UPSERT` with VALUES rows.
 */
export async function reorderManualPicks(
  input: z.input<typeof Schema>
): Promise<Result<{ count: number }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ count: number }>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<{ count: number }>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();

  // Apply sort_order = i in sequence. Errors short-circuit.
  let updated = 0;
  for (let i = 0; i < parsed.data.ordered_ids.length; i++) {
    const id = parsed.data.ordered_ids[i];
    const { error } = await admin
      .from("related_products_manual_picks")
      .update({ sort_order: i })
      .eq("id", id)
      .eq("association_id", parsed.data.association_id);
    if (error) {
      return fail<{ count: number }>(
        `Failed to reorder pick ${id}: ${error.message}`,
        error.code
      );
    }
    updated++;
  }

  revalidatePath("/admin/related-products");
  return ok({ count: updated });
}
