"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/types/result";
import { resolveProductIds } from "@/lib/bulk-selection/resolveProductIds";
import { FilterParamsSchema } from "@/lib/admin-products-filter/schema";

const Schema = z.object({
  ids: z.array(z.string().uuid()).nullable(),
  matchAll: z.boolean(),
  filterParams: FilterParamsSchema,
});

/**
 * Bulk-deletes products. Per-product transactional via the products table's
 * own cascade rules (variants, images, specs, etc. cascade). Supply orders
 * RESTRICT — if any product in the set has supply order history, the
 * whole bulk delete returns a friendly error pointing at those IDs.
 */
export async function bulkDeleteProducts(
  input: z.input<typeof Schema>
): Promise<Result<{ deleted: number; failed: Array<{ id: string; reason: string }> }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<{ deleted: number; failed: Array<{ id: string; reason: string }> }>(
      "Invalid input",
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<{ deleted: number; failed: Array<{ id: string; reason: string }> }>(
      "Forbidden",
      "FORBIDDEN"
    );
  }

  const resolved = await resolveProductIds({
    ids: parsed.data.ids,
    matchAll: parsed.data.matchAll,
    filterParams: parsed.data.filterParams,
  });
  if (!resolved.ok) {
    return fail<{ deleted: number; failed: Array<{ id: string; reason: string }> }>(
      resolved.error,
      resolved.code
    );
  }
  if (resolved.ids.length === 0)
    return ok({ deleted: 0, failed: [] });

  const admin = createAdminClient();
  const failed: Array<{ id: string; reason: string }> = [];
  let deleted = 0;

  for (const id of resolved.ids) {
    const { error } = await admin.from("products").delete().eq("id", id);
    if (error) {
      failed.push({ id, reason: error.message });
    } else {
      deleted++;
    }
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (authData.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "product.bulk_deleted",
      resource_type: "product",
      metadata: { deleted, failed_count: failed.length, ids: resolved.ids },
    });
  }

  revalidatePath("/admin/products");
  return ok({ deleted, failed });
}
