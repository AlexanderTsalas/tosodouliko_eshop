"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import { resolveProductIds } from "@/lib/bulk-selection/resolveProductIds";
import { FilterParamsSchema } from "@/lib/admin-products-filter/schema";

/**
 * Mode for each scalar field:
 *   - "skip"  → field is not touched on any product
 *   - "set"   → field is set to `value`
 *   - "clear" → field is set to null (only valid on nullable columns)
 */
const FieldOp = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("set"), value: z.unknown() }),
  z.object({ mode: z.literal("clear") }),
]);

const CategoryOp = z.object({
  op: z.enum(["add", "remove", "replace"]),
  categoryIds: z.array(z.string().uuid()),
});

const SpecOp = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add"),
    attributeId: z.string().uuid(),
    value: z.string().min(1).max(500),
  }),
  z.object({
    op: z.literal("remove"),
    attributeId: z.string().uuid(),
  }),
  z.object({
    op: z.literal("replace"),
    attributeId: z.string().uuid(),
    value: z.string().min(1).max(500),
  }),
]);

const SupplierLinkOp = z.object({
  supplierId: z.string().uuid(),
  isPreferred: z.boolean().default(true),
});

const Schema = z.object({
  ids: z.array(z.string().uuid()).nullable(),
  matchAll: z.boolean(),
  filterParams: FilterParamsSchema,
  scalars: z
    .object({
      description: FieldOp.optional(),
      basePrice: FieldOp.optional(),
      currency: FieldOp.optional(),
      brand: FieldOp.optional(),
      active: FieldOp.optional(),
      weightG: FieldOp.optional(),
      // Physical box dimensions for volumetric shipping pricing.
      // Same semantics as single-product edit — nullable; clear =
      // inherit carrier default. Useful for bulk when a range shares
      // one box size (e.g., a set of identically-packaged toys).
      lengthMm: FieldOp.optional(),
      widthMm: FieldOp.optional(),
      heightMm: FieldOp.optional(),
      // Carrier-specific volumetric prefix override. Nullable;
      // clear = use the carrier's default.
      volumetricPrefixId: FieldOp.optional(),
      ageMin: FieldOp.optional(),
      ageMax: FieldOp.optional(),
      // Out-of-stock storefront visibility override. Nullable;
      // clear = inherit global storefront_settings default.
      showWhenOos: FieldOp.optional(),
      vatRateId: FieldOp.optional(),
      costPrice: FieldOp.optional(),
      costCurrency: FieldOp.optional(),
      defaultSupplierId: FieldOp.optional(),
    })
    .optional(),
  categoryOp: CategoryOp.optional(),
  specOp: SpecOp.optional(),
  supplierLinkOp: SupplierLinkOp.optional(),
});

interface BulkResult {
  succeeded: number;
  failed: Array<{ id: string; reason: string }>;
}

/**
 * Bulk-applies a set of operations to N products. Loops per product, captures
 * errors per row, reports them in the response. Always succeeds at the
 * action level (i.e. returns ok) even if individual products fail —
 * callers render the failure list.
 *
 * The scalar field map maps the form's camelCase keys to DB snake_case
 * columns. Sale-price columns and slug/name are deliberately omitted:
 *   - name/slug: bulk-renaming N products is almost always a mistake.
 */
const COLUMN_MAP: Record<string, string> = {
  description: "description",
  basePrice: "base_price",
  currency: "currency",
  brand: "brand",
  active: "active",
  weightG: "weight_g",
  lengthMm: "length_mm",
  widthMm: "width_mm",
  heightMm: "height_mm",
  volumetricPrefixId: "volumetric_prefix_id",
  ageMin: "age_min",
  ageMax: "age_max",
  showWhenOos: "show_when_oos",
  vatRateId: "vat_rate_id",
  costPrice: "cost_price",
  costCurrency: "cost_currency",
  defaultSupplierId: "default_supplier_id",
};

export async function bulkUpdateProducts(
  input: z.input<typeof Schema>
): Promise<Result<BulkResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<BulkResult>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:products"))) {
    return fail<BulkResult>("Forbidden", "FORBIDDEN");
  }

  // Resolve selection.
  const resolved = await resolveProductIds({
    ids: parsed.data.ids,
    matchAll: parsed.data.matchAll,
    filterParams: parsed.data.filterParams,
  });
  if (!resolved.ok) return fail<BulkResult>(resolved.error, resolved.code);
  if (resolved.ids.length === 0) {
    return ok({ succeeded: 0, failed: [] });
  }

  const admin = createAdminClient();
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  // Build the scalar UPDATE payload — same for every product.
  const scalarUpdate: Record<string, unknown> = {};
  if (parsed.data.scalars) {
    for (const [key, op] of Object.entries(parsed.data.scalars)) {
      if (!op) continue;
      const col = COLUMN_MAP[key];
      if (!col) continue;
      if (op.mode === "clear") {
        scalarUpdate[col] = null;
      } else {
        scalarUpdate[col] = op.value;
      }
    }
  }
  const hasScalarOps = Object.keys(scalarUpdate).length > 0;
  if (hasScalarOps) scalarUpdate.updated_at = new Date().toISOString();

  // Apply per product.
  const failed: Array<{ id: string; reason: string }> = [];
  let succeeded = 0;

  for (const productId of resolved.ids) {
    try {
      // 1. Scalar update.
      if (hasScalarOps) {
        const { error } = await admin
          .from("products")
          .update(scalarUpdate)
          .eq("id", productId);
        if (error) throw new Error(`scalar: ${error.message}`);
      }

      // 2. Category op.
      if (parsed.data.categoryOp) {
        const { op, categoryIds } = parsed.data.categoryOp;
        if (op === "replace") {
          await admin.from("product_categories").delete().eq("product_id", productId);
          if (categoryIds.length > 0) {
            const rows = categoryIds.map((cid) => ({ product_id: productId, category_id: cid }));
            const { error } = await admin.from("product_categories").insert(rows);
            if (error) throw new Error(`categories.replace: ${error.message}`);
          }
        } else if (op === "add") {
          const rows = categoryIds.map((cid) => ({ product_id: productId, category_id: cid }));
          // Upsert-style: ignore duplicates by adding ON CONFLICT (which the
          // table's PK satisfies as (product_id, category_id)).
          const { error } = await admin
            .from("product_categories")
            .upsert(rows, { onConflict: "product_id,category_id", ignoreDuplicates: true });
          if (error) throw new Error(`categories.add: ${error.message}`);
        } else if (op === "remove") {
          const { error } = await admin
            .from("product_categories")
            .delete()
            .eq("product_id", productId)
            .in("category_id", categoryIds);
          if (error) throw new Error(`categories.remove: ${error.message}`);
        }
      }

      // 3. Spec op.
      if (parsed.data.specOp) {
        const specOp = parsed.data.specOp;
        if (specOp.op === "remove") {
          const { error } = await admin
            .from("product_specifications")
            .delete()
            .eq("product_id", productId)
            .eq("attribute_id", specOp.attributeId);
          if (error) throw new Error(`spec.remove: ${error.message}`);
        } else if (specOp.op === "replace") {
          // Delete the existing row (if any), then insert. Safer than upsert
          // because we change the value on conflict.
          await admin
            .from("product_specifications")
            .delete()
            .eq("product_id", productId)
            .eq("attribute_id", specOp.attributeId);
          const { error } = await admin.from("product_specifications").insert({
            product_id: productId,
            attribute_id: specOp.attributeId,
            value: specOp.value,
          });
          if (error) throw new Error(`spec.replace: ${error.message}`);
        } else if (specOp.op === "add") {
          // Upsert — if it already exists, update the value.
          const { error } = await admin.from("product_specifications").upsert(
            {
              product_id: productId,
              attribute_id: specOp.attributeId,
              value: specOp.value,
            },
            { onConflict: "product_id,attribute_id" }
          );
          if (error) throw new Error(`spec.add: ${error.message}`);
        }
      }

      // 4. Supplier link op — link the supplier to every variant of this
      //    product. If a link already exists, leave it alone (no overwrite).
      //    Marks one variant per product as preferred if isPreferred=true and
      //    no other preferred row exists.
      if (parsed.data.supplierLinkOp) {
        const { supplierId, isPreferred } = parsed.data.supplierLinkOp;
        const { data: variantRows } = await admin
          .from("product_variants")
          .select("id, supplier_products(id, supplier_id, is_preferred)")
          .eq("product_id", productId);
        type Row = {
          id: string;
          supplier_products: Array<{ id: string; supplier_id: string; is_preferred: boolean }> | null;
        };
        const variants = (variantRows ?? []) as Row[];

        const toInsert: Array<{ variant_id: string; supplier_id: string; is_preferred: boolean }> = [];
        for (const v of variants) {
          const existing = (v.supplier_products ?? []).some((sp) => sp.supplier_id === supplierId);
          if (existing) continue;
          const hasAnyPreferred = (v.supplier_products ?? []).some((sp) => sp.is_preferred);
          toInsert.push({
            variant_id: v.id,
            supplier_id: supplierId,
            is_preferred: isPreferred && !hasAnyPreferred,
          });
        }
        if (toInsert.length > 0) {
          const { error } = await admin.from("supplier_products").insert(toInsert);
          if (error) throw new Error(`supplier_link: ${error.message}`);
        }
      }

      succeeded++;
    } catch (e) {
      failed.push({ id: productId, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  // One audit event with the full operation summary.
  if (authData.user) {
    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "product.bulk_updated",
      resource_type: "product",
      metadata: {
        succeeded,
        failed_count: failed.length,
        ids: resolved.ids,
        ops: {
          scalars: hasScalarOps ? Object.keys(scalarUpdate).filter((k) => k !== "updated_at") : [],
          categories: parsed.data.categoryOp?.op ?? null,
          spec: parsed.data.specOp?.op ?? null,
          supplier_link: parsed.data.supplierLinkOp?.supplierId ?? null,
        },
      },
    });
  }

  revalidatePath("/admin/products");
  return ok({ succeeded, failed });
}
