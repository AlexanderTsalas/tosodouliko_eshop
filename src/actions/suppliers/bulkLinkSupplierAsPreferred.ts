"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  supplierId: z.string().uuid(),
  variantIds: z.array(z.string().uuid()).min(1).max(500),
});

interface BulkResult {
  linked: number;
  skipped: number;
}

/**
 * Marks the named supplier as the preferred source for every variant
 * in the input list. For each variant:
 *
 *   - If a row in supplier_products already exists for this (variant,
 *     supplier) pair, it's flipped to is_preferred=true (and any sibling
 *     preferred row on the same variant is demoted first to satisfy the
 *     partial unique index).
 *   - If no row exists, a new supplier_products row is inserted with
 *     is_preferred=true.
 *
 * Used by the Supply Orders "products without supplier" panel when the
 * admin selects multiple low-stock variants and assigns one supplier in
 * one click instead of opening each variant page.
 */
export async function bulkLinkSupplierAsPreferred(
  input: z.input<typeof Schema>
): Promise<Result<BulkResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<BulkResult>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:suppliers"))) {
    return fail<BulkResult>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  // 1. Demote any existing preferred rows on the target variants.
  //    The partial unique index `unique_preferred_per_variant` (variant_id
  //    WHERE is_preferred) would reject the upserts below otherwise.
  await supabase
    .from("supplier_products")
    .update({ is_preferred: false })
    .in("variant_id", parsed.data.variantIds)
    .eq("is_preferred", true);

  // 2. Figure out which (variant, supplier) pairs already exist so we
  //    can UPDATE them vs INSERT new rows.
  const { data: existingRows } = await supabase
    .from("supplier_products")
    .select("id, variant_id")
    .eq("supplier_id", parsed.data.supplierId)
    .in("variant_id", parsed.data.variantIds);

  const existingByVariant = new Map<string, string>();
  for (const r of (existingRows ?? []) as Array<{ id: string; variant_id: string }>) {
    existingByVariant.set(r.variant_id, r.id);
  }

  let linked = 0;
  const skipped = 0;

  // 3. Update existing rows to is_preferred=true.
  if (existingByVariant.size > 0) {
    const { error } = await supabase
      .from("supplier_products")
      .update({ is_preferred: true })
      .in("id", Array.from(existingByVariant.values()));
    if (error) {
      return fail<BulkResult>(error.message, error.code);
    }
    linked += existingByVariant.size;
  }

  // 4. Insert new rows for variants that don't have this supplier yet.
  const newVariantIds = parsed.data.variantIds.filter(
    (vid) => !existingByVariant.has(vid)
  );
  if (newVariantIds.length > 0) {
    const insertRows = newVariantIds.map((vid) => ({
      variant_id: vid,
      supplier_id: parsed.data.supplierId,
      is_preferred: true,
    }));
    const { error } = await supabase.from("supplier_products").insert(insertRows);
    if (error) {
      // Partial failure — return what succeeded above. The DB unique
      // index would only fire here if a row was created between steps 2
      // and 4 by another writer, which is rare; report the error so the
      // admin can retry.
      return fail<BulkResult>(
        `Inserted ${linked} updates but new-row insert failed: ${error.message}`,
        error.code
      );
    }
    linked += newVariantIds.length;
  }

  if (authData?.user && linked > 0) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "supplier_product.bulk_linked_preferred",
      resource_type: "supplier",
      resource_id: parsed.data.supplierId,
      metadata: {
        variant_count: linked,
        variant_ids: parsed.data.variantIds,
      },
    });
  }

  revalidatePath("/admin/supply-orders");
  return ok({ linked, skipped });
}
