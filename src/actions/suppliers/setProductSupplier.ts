"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  productId: z.string().uuid(),
  supplierId: z.string().uuid(),
  /**
   * Default supplier_sku for ALL variants of this product. Pass null to
   * clear (no SKU on any variant). Omit (undefined) to leave existing
   * SKUs untouched.
   */
  supplierSku: z.string().max(200).nullable().optional(),
  /**
   * Default unit cost for ALL variants. Pass null to clear. Pair with
   * unitCostCurrency or omit both.
   */
  unitCost: z.number().nonnegative().nullable().optional(),
  unitCostCurrency: z.string().length(3).toUpperCase().nullable().optional(),
  /**
   * Mark this supplier as the preferred one across all variants. When
   * true, every other supplier's is_preferred is cleared for these
   * variants (the partial unique index allows only one preferred per
   * variant).
   */
  isPreferred: z.boolean().optional(),
});

interface UpsertResult {
  rowsAffected: number;
  rowsCreated: number;
}

/**
 * Configure a supplier across ALL variants of a product in one go —
 * the product-level supplier UX on the overview page.
 *
 * Semantics:
 *   - If the supplier isn't linked to a given variant yet, a new
 *     supplier_products row is created.
 *   - If it is linked, its SKU / cost / preferred flag is updated.
 *   - Fields are only modified if explicitly provided (undefined means
 *     "leave as-is"); null means "clear this field".
 *   - When isPreferred=true, every other supplier's row for the same
 *     variants is demoted first (partial unique index requires one
 *     preferred max per variant).
 *
 * Returns counts so the caller can show "Synced X rows, created Y" UX.
 */
export async function setProductSupplier(
  input: z.input<typeof Schema>
): Promise<Result<UpsertResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<UpsertResult>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:suppliers"))) {
    return fail<UpsertResult>("Forbidden", "FORBIDDEN");
  }

  // Cost / currency pairing check at the action layer so we don't
  // surface a CHECK constraint violation from Postgres.
  const costProvided = parsed.data.unitCost !== undefined;
  const ccyProvided = parsed.data.unitCostCurrency !== undefined;
  if (costProvided !== ccyProvided) {
    return fail<UpsertResult>(
      "unitCost and unitCostCurrency must be updated together.",
      "INVALID_COST_PAIR"
    );
  }
  if (costProvided && ccyProvided) {
    const costNull = parsed.data.unitCost === null;
    const ccyNull = parsed.data.unitCostCurrency === null;
    if (costNull !== ccyNull) {
      return fail<UpsertResult>(
        "unitCost and unitCostCurrency must be both null or both set.",
        "INVALID_COST_PAIR"
      );
    }
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  // 1. All variants of this product.
  const { data: variants } = await supabase
    .from("product_variants")
    .select("id")
    .eq("product_id", parsed.data.productId);
  const variantIds = ((variants ?? []) as Array<{ id: string }>).map((v) => v.id);
  if (variantIds.length === 0) {
    // Suppliers are modelled per-variant (supplier_products). A product
    // with no variants has nowhere to store one, so guide the admin to the
    // correct order rather than stashing it in a column the panel doesn't
    // read back as "preferred".
    return fail<UpsertResult>(
      "Δεν υπάρχουν παραλλαγές. Δημιουργήστε πρώτα παραλλαγές πριν συνδέσετε προμηθευτή.",
      "NO_VARIANTS"
    );
  }

  // 2. Existing supplier_products rows for (variants, supplier).
  const { data: existing } = await supabase
    .from("supplier_products")
    .select("id, variant_id")
    .eq("supplier_id", parsed.data.supplierId)
    .in("variant_id", variantIds);
  const existingByVariant = new Map(
    ((existing ?? []) as Array<{ id: string; variant_id: string }>).map((r) => [
      r.variant_id,
      r.id,
    ])
  );

  // 3. If promoting to preferred, demote any other preferred row for
  //    these variants first (clears the path for the unique index).
  if (parsed.data.isPreferred === true) {
    await supabase
      .from("supplier_products")
      .update({ is_preferred: false })
      .in("variant_id", variantIds)
      .eq("is_preferred", true)
      .neq("supplier_id", parsed.data.supplierId);
  }

  // 4. Update existing rows. We can do this in one UPDATE if all
  //    columns match what the caller specified.
  const updateFields: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.supplierSku !== undefined)
    updateFields.supplier_sku = parsed.data.supplierSku;
  if (parsed.data.unitCost !== undefined)
    updateFields.unit_cost = parsed.data.unitCost;
  if (parsed.data.unitCostCurrency !== undefined)
    updateFields.unit_cost_currency = parsed.data.unitCostCurrency;
  if (parsed.data.isPreferred !== undefined)
    updateFields.is_preferred = parsed.data.isPreferred;

  const idsToUpdate = Array.from(existingByVariant.values());
  if (idsToUpdate.length > 0 && Object.keys(updateFields).length > 1) {
    const { error: updateErr } = await supabase
      .from("supplier_products")
      .update(updateFields)
      .in("id", idsToUpdate);
    if (updateErr) {
      return fail<UpsertResult>(updateErr.message, updateErr.code);
    }
  }

  // 5. Insert rows for variants that don't have a link yet.
  const newVariantIds = variantIds.filter((vid) => !existingByVariant.has(vid));
  let rowsCreated = 0;
  if (newVariantIds.length > 0) {
    const newRows = newVariantIds.map((vid) => ({
      variant_id: vid,
      supplier_id: parsed.data.supplierId,
      supplier_sku: parsed.data.supplierSku ?? null,
      unit_cost: parsed.data.unitCost ?? null,
      unit_cost_currency: parsed.data.unitCostCurrency ?? null,
      is_preferred: parsed.data.isPreferred ?? false,
    }));
    const { error: insertErr } = await supabase
      .from("supplier_products")
      .insert(newRows);
    if (insertErr) {
      // Partial failure: some updates succeeded, inserts failed. Report
      // the error so the admin can retry.
      return fail<UpsertResult>(insertErr.message, insertErr.code);
    }
    rowsCreated = newRows.length;
  }

  if (authData?.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "supplier_product.product_sync",
      resource_type: "product",
      resource_id: parsed.data.productId,
      metadata: {
        supplier_id: parsed.data.supplierId,
        variants_total: variantIds.length,
        rows_created: rowsCreated,
        rows_updated: idsToUpdate.length,
      },
    });
  }

  revalidatePath("/admin/products");
  revalidatePath("/admin/supply-orders");
  return ok({
    rowsAffected: idsToUpdate.length + rowsCreated,
    rowsCreated,
  });
}

/**
 * Remove a supplier from EVERY variant of a product. Hard-delete on
 * supplier_products; the supplier itself is untouched.
 */
const RemoveSchema = z.object({
  productId: z.string().uuid(),
  supplierId: z.string().uuid(),
});

export async function removeProductSupplier(
  input: z.input<typeof RemoveSchema>
): Promise<Result<{ deleted: number }>> {
  const parsed = RemoveSchema.safeParse(input);
  if (!parsed.success) {
    return fail<{ deleted: number }>("Invalid input", "INVALID_INPUT");
  }
  if (!(await checkPermission("manage:suppliers"))) {
    return fail<{ deleted: number }>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  const { data: variants } = await supabase
    .from("product_variants")
    .select("id")
    .eq("product_id", parsed.data.productId);
  const variantIds = ((variants ?? []) as Array<{ id: string }>).map((v) => v.id);
  if (variantIds.length === 0) return ok({ deleted: 0 });

  const { data: deleted, error } = await supabase
    .from("supplier_products")
    .delete()
    .eq("supplier_id", parsed.data.supplierId)
    .in("variant_id", variantIds)
    .select("id");

  if (error) return fail<{ deleted: number }>(error.message, error.code);

  if (authData?.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "supplier_product.product_unlink",
      resource_type: "product",
      resource_id: parsed.data.productId,
      metadata: {
        supplier_id: parsed.data.supplierId,
        rows_deleted: deleted?.length ?? 0,
      },
    });
  }

  revalidatePath("/admin/products");
  return ok({ deleted: deleted?.length ?? 0 });
}
