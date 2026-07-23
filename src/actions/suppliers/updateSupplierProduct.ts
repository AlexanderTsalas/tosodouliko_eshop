"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { SupplierProduct } from "@/types/suppliers";

const Schema = z.object({
  id: z.string().uuid(),
  supplierSku: z.string().max(200).nullable().optional(),
  leadTimeDays: z.number().int().nonnegative().nullable().optional(),
  isPreferred: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
  /**
   * Negotiated unit cost. Pair with unitCostCurrency. Pass `null` for
   * both to clear the cost. Pass both numbers/strings to set them.
   * Omit (leave undefined) to leave them untouched.
   */
  unitCost: z.number().nonnegative().nullable().optional(),
  unitCostCurrency: z
    .string()
    .length(3)
    .toUpperCase()
    .nullable()
    .optional(),
});

export async function updateSupplierProduct(
  input: z.input<typeof Schema>
): Promise<Result<SupplierProduct>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<SupplierProduct>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:suppliers"))) {
    return fail<SupplierProduct>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  // Promoting to preferred: demote any other preferred row for the same variant.
  if (parsed.data.isPreferred === true) {
    const { data: row } = await supabase
      .from("supplier_products")
      .select("variant_id")
      .eq("id", parsed.data.id)
      .maybeSingle();
    const variantId = (row as { variant_id: string } | null)?.variant_id;
    if (variantId) {
      await supabase
        .from("supplier_products")
        .update({ is_preferred: false })
        .eq("variant_id", variantId)
        .eq("is_preferred", true)
        .neq("id", parsed.data.id);
    }
  }

  // Mirror the supplier_products CHECK constraint: unit_cost and
  // unit_cost_currency must both be NULL or both be NON-NULL. If the
  // caller only sent one of the two fields, validate at this layer
  // rather than letting the DB throw a confusing CHECK violation.
  const costProvided = parsed.data.unitCost !== undefined;
  const ccyProvided = parsed.data.unitCostCurrency !== undefined;
  if (costProvided !== ccyProvided) {
    return fail<SupplierProduct>(
      "unitCost and unitCostCurrency must be updated together.",
      "INVALID_COST_PAIR"
    );
  }
  if (costProvided && ccyProvided) {
    const costNull = parsed.data.unitCost === null;
    const ccyNull = parsed.data.unitCostCurrency === null;
    if (costNull !== ccyNull) {
      return fail<SupplierProduct>(
        "unitCost and unitCostCurrency must be both null or both set.",
        "INVALID_COST_PAIR"
      );
    }
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.supplierSku !== undefined) update.supplier_sku = parsed.data.supplierSku;
  if (parsed.data.leadTimeDays !== undefined) update.lead_time_days = parsed.data.leadTimeDays;
  if (parsed.data.isPreferred !== undefined) update.is_preferred = parsed.data.isPreferred;
  if (parsed.data.notes !== undefined) update.notes = parsed.data.notes;
  if (parsed.data.active !== undefined) update.active = parsed.data.active;
  if (parsed.data.unitCost !== undefined) update.unit_cost = parsed.data.unitCost;
  if (parsed.data.unitCostCurrency !== undefined)
    update.unit_cost_currency = parsed.data.unitCostCurrency;

  const { data, error } = await supabase
    .from("supplier_products")
    .update(update)
    .eq("id", parsed.data.id)
    .select()
    .single();

  if (error || !data) {
    return fail<SupplierProduct>(error?.message ?? "Update failed", error?.code);
  }

  if (authData.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "supplier_product.updated",
      resource_type: "supplier_product",
      resource_id: parsed.data.id,
      metadata: { fields: Object.keys(update).filter((k) => k !== "updated_at") },
    });
  }

  revalidatePath(`/admin/products`);
  return ok(data as unknown as SupplierProduct);
}
