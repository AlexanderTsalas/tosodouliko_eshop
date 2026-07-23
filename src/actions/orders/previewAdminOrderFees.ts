"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveFees } from "@/lib/fees/resolve";
import { listActiveCarriers } from "@/lib/courier/listActiveCarriers";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { FeeBreakdownEntry } from "@/types/fee";

/**
 * Real-time fee preview for the admin "Νέα παραγγελία" form.
 *
 * Mirrors the customer-facing `previewFees` but takes EXPLICIT item
 * data (admins aren't operating from a cart — they build the order
 * inline). Calls the same `resolveFees` primitive that the actual
 * `createOrder` action uses, so the numbers the admin sees during
 * editing match what gets persisted on submit exactly.
 *
 * Returns an empty breakdown (fees_total = 0) for partial input
 * (no items, no delivery method, no zipcode) rather than throwing —
 * the form treats "not enough info yet" as a normal state.
 *
 * The carrier API path inside resolveFees is best-effort and
 * time-boxed; if the carrier service is slow or down the resolver
 * falls back to custom rules and we never block the UI.
 */

const ItemSchema = z.object({
  variant_id: z.string().uuid(),
  quantity: z.number().int().positive(),
});

const Schema = z.object({
  payment_method: z.enum(["cod", "cash_on_pickup", "bank_transfer"]),
  delivery_method: z.enum([
    "home_delivery",
    "store_pickup",
    "delivery_station_pickup",
    "carrier_pickup",
  ]),
  carrier: z
    .enum(["acs", "elta", "box_now", "speedex", "geniki", "other"])
    .nullable()
    .optional(),
  items: z.array(ItemSchema).max(200),
  recipient_zipcode: z.string().optional(),
  recipient_country: z.string().optional(),
  station_destination: z.string().nullable().optional(),
});

export interface AdminFeePreviewResult {
  fees_total: number;
  fees_breakdown: FeeBreakdownEntry[];
  /** Item subtotal (sum of variant.price × quantity, server-priced). */
  subtotal: number;
  /** Total weight in kg used for the resolution (sum of variant.weight_kg × qty). */
  weight_kg: number;
}

const EMPTY: AdminFeePreviewResult = {
  fees_total: 0,
  fees_breakdown: [],
  subtotal: 0,
  weight_kg: 0,
};

export async function previewAdminOrderFees(
  input: z.input<typeof Schema>
): Promise<Result<AdminFeePreviewResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<AdminFeePreviewResult>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:orders"))) {
    return fail<AdminFeePreviewResult>("Forbidden", "FORBIDDEN");
  }

  if (parsed.data.items.length === 0) return ok(EMPTY);

  const admin = createAdminClient();

  // Fetch every selected variant in one query — we need price + weight
  // + product_id + category_ids to feed resolveFees.
  const variantIds = parsed.data.items.map((i) => i.variant_id);
  const { data: variantRows } = await admin
    .from("product_variants")
    .select("id, product_id, price, weight_kg")
    .in("id", variantIds);
  type VariantRow = {
    id: string;
    product_id: string;
    price: number | string;
    weight_kg: number | string | null;
  };
  const variantById = new Map<string, VariantRow>(
    ((variantRows ?? []) as VariantRow[]).map((v) => [v.id, v])
  );

  // Compute subtotal + weight + qty. Use SERVER prices, not whatever
  // the client may have typed — admins can override prices in the form,
  // but the fee resolver wants the canonical price for tiered rules.
  let subtotal = 0;
  let totalWeightKg = 0;
  let itemQty = 0;
  const productIds = new Set<string>();
  for (const item of parsed.data.items) {
    const v = variantById.get(item.variant_id);
    if (!v) continue;
    subtotal =
      Math.round((subtotal + Number(v.price) * item.quantity) * 100) / 100;
    totalWeightKg += (Number(v.weight_kg ?? 0) || 0) * item.quantity;
    itemQty += item.quantity;
    productIds.add(v.product_id);
  }

  // Resolve category ids in one query for all relevant products.
  const productIdArr = Array.from(productIds);
  const { data: pcRows } =
    productIdArr.length === 0
      ? { data: [] as Array<{ category_id: string }> }
      : await admin
          .from("product_categories")
          .select("category_id")
          .in("product_id", productIdArr);
  const categoryIds = Array.from(
    new Set(
      ((pcRows ?? []) as Array<{ category_id: string }>).map(
        (r) => r.category_id
      )
    )
  );

  // Active-carrier guard — mirrors previewFees. If the admin picked
  // a carrier that's been deactivated between page load and now,
  // treat as null so resolveFees uses custom rules instead of trying
  // to quote a dead carrier.
  const requestedCarrier =
    parsed.data.delivery_method === "store_pickup"
      ? null
      : (parsed.data.carrier ?? null);
  const activeCarriers = await listActiveCarriers();
  const resolvedCarrier =
    requestedCarrier &&
    activeCarriers.some((c) => c.slug === requestedCarrier)
      ? requestedCarrier
      : null;

  const result = await resolveFees({
    payment_method: parsed.data.payment_method,
    delivery_method: parsed.data.delivery_method,
    carrier: resolvedCarrier,
    subtotal,
    // For non-COD orders the resolver ignores cod_amount (the
    // cod_handling rules don't fire). Passing subtotal keeps the
    // shape symmetric with placeOrder / createOrder.
    cod_amount: subtotal,
    product_ids: productIdArr,
    variant_ids: variantIds,
    category_ids: categoryIds,
    recipient_zipcode: parsed.data.recipient_zipcode,
    recipient_country: parsed.data.recipient_country,
    weight_kg: totalWeightKg,
    item_quantity: itemQty,
    station_destination: parsed.data.station_destination ?? null,
  });

  return ok({
    fees_total: result.fees_total,
    fees_breakdown: result.fees_breakdown,
    subtotal,
    weight_kg: totalWeightKg,
  });
}
