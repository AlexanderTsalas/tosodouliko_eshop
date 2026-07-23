"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { SupplierProduct } from "@/types/suppliers";

const Schema = z.object({
  variantId: z.string().uuid(),
  supplierId: z.string().uuid(),
  supplierSku: z.string().max(200).nullable().optional(),
  leadTimeDays: z.number().int().nonnegative().nullable().optional(),
  isPreferred: z.boolean().default(false),
  notes: z.string().max(2000).nullable().optional(),
  /**
   * Negotiated unit cost from this supplier for this variant. Pair with
   * unitCostCurrency — providing one without the other is a schema
   * violation (CHECK constraint on supplier_products).
   */
  unitCost: z.number().nonnegative().nullable().optional(),
  unitCostCurrency: z
    .string()
    .length(3)
    .toUpperCase()
    .nullable()
    .optional(),
});

export async function linkSupplierToVariant(
  input: z.input<typeof Schema>
): Promise<Result<SupplierProduct>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<SupplierProduct>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:suppliers"))) {
    return fail<SupplierProduct>("Forbidden", "FORBIDDEN");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  // If marking as preferred, demote any existing preferred row first
  // (the partial unique index would otherwise reject the insert).
  if (parsed.data.isPreferred) {
    await supabase
      .from("supplier_products")
      .update({ is_preferred: false })
      .eq("variant_id", parsed.data.variantId)
      .eq("is_preferred", true);
  }

  // Enforce the unit_cost / unit_cost_currency pairing constraint at the
  // action boundary so callers get a nice error instead of a DB CHECK
  // violation. NULL/NULL is fine; otherwise both are required.
  const hasCost = parsed.data.unitCost !== null && parsed.data.unitCost !== undefined;
  const hasCcy = !!parsed.data.unitCostCurrency;
  if (hasCost !== hasCcy) {
    return fail<SupplierProduct>(
      "unitCost and unitCostCurrency must be provided together.",
      "INVALID_COST_PAIR"
    );
  }

  const { data, error } = await supabase
    .from("supplier_products")
    .insert({
      variant_id: parsed.data.variantId,
      supplier_id: parsed.data.supplierId,
      supplier_sku: parsed.data.supplierSku ?? null,
      lead_time_days: parsed.data.leadTimeDays ?? null,
      is_preferred: parsed.data.isPreferred,
      notes: parsed.data.notes ?? null,
      unit_cost: hasCost ? parsed.data.unitCost : null,
      unit_cost_currency: hasCcy ? parsed.data.unitCostCurrency : null,
    })
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return fail<SupplierProduct>(
        "This supplier is already linked to this variant.",
        "ALREADY_LINKED"
      );
    }
    return fail<SupplierProduct>(error?.message ?? "Insert failed", error?.code);
  }

  if (authData.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "supplier_product.linked",
      resource_type: "supplier_product",
      resource_id: (data as { id: string }).id,
      metadata: {
        variant_id: parsed.data.variantId,
        supplier_id: parsed.data.supplierId,
      },
    });
  }

  revalidatePath(`/admin/products`);
  return ok(data as unknown as SupplierProduct);
}
