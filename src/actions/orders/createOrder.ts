"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { resolveFees } from "@/lib/fees/resolve";
import { resolveComboLabels } from "@/lib/variants/resolveComboLabel";
import { fail, ok, type Result } from "@/types/result";
import type { Customer } from "@/types/customer";

const AddressSchema = z
  .object({
    first_name: z.string().max(100).optional(),
    last_name: z.string().max(100).optional(),
    street: z.string().max(300).optional(),
    city: z.string().max(120).optional(),
    postal_code: z.string().max(20).optional(),
    country_code: z.string().length(2).optional(),
    phone: z.string().max(40).optional(),
    notes: z.string().max(500).optional(),
  })
  .partial();

const Schema = z.object({
  /**
   * Pre-resolved customer. Callers (admin NewOrderForm, future customer
   * checkout) resolve the customer via matchOrCreateCustomer first so the
   * dedup-confirmation UX happens before this action runs.
   */
  customer_id: z.string().uuid(),

  // Three order axes. Stripe excluded for manual orders by design.
  payment_method: z.enum(["cod", "cash_on_pickup", "bank_transfer"]),
  delivery_method: z.enum([
    "home_delivery",
    "store_pickup",
    "delivery_station_pickup",
    "carrier_pickup",
  ]),
  carrier: z.enum(["acs", "elta", "box_now", "speedex", "geniki", "other"]).nullable().optional(),
  source: z.enum(["phone", "in_store"]).default("phone"),

  // Money
  currency: z.string().length(3).default("EUR"),
  discount_amount: z.number().min(0).default(0),
  shipping_amount: z.number().min(0).default(0),
  tax_amount: z.number().min(0).default(0),

  // Items
  items: z
    .array(
      z.object({
        variant_id: z.string().uuid(),
        quantity: z.number().int().positive(),
        /** Override unit price; if absent, snapshot variant.price at write time. */
        unit_price: z.number().min(0).optional(),
      })
    )
    .min(1)
    .max(100),

  // Addresses
  shipping_address: AddressSchema.optional(),
  billing_address: AddressSchema.optional(),

  // Misc
  notes: z.string().max(2000).optional(),

  /** When true, fulfillment_status='draft' and inventory is untouched. */
  as_draft: z.boolean().default(false),
});

interface CreateResult {
  order_id: string;
  order_number: string;
}

/**
 * Manual order creation. Reads the resolved customer (from `customer_id`) to
 * snapshot contact info on the order row — the snapshots stay frozen even if
 * the customer record is later corrected. Reserves inventory unless saved as
 * a draft.
 */
export async function createOrder(
  input: z.input<typeof Schema>
): Promise<Result<CreateResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<CreateResult>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  if (!(await checkPermission("manage:orders"))) {
    return fail<CreateResult>("Forbidden", "FORBIDDEN");
  }

  if (parsed.data.delivery_method === "store_pickup" && parsed.data.carrier) {
    return fail<CreateResult>(
      "store_pickup orders must not have a carrier",
      "INVALID_INPUT"
    );
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<CreateResult>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();

  // Resolve customer for the snapshot fields.
  const { data: customerRow, error: custErr } = await admin
    .from("customers")
    .select("id, email, phone, first_name, last_name")
    .eq("id", parsed.data.customer_id)
    .maybeSingle();
  if (custErr || !customerRow) {
    return fail<CreateResult>("Customer not found", "CUSTOMER_NOT_FOUND");
  }
  const customer = customerRow as Pick<
    Customer,
    "id" | "email" | "phone" | "first_name" | "last_name"
  >;

  const customerNameAtOrder =
    [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim() || null;

  // Batch-snapshot variant info for line writes.
  const variantIds = parsed.data.items.map((i) => i.variant_id);
  const { data: variantRows, error: vErr } = await admin
    .from("product_variants")
    .select("id, product_id, sku, attribute_combo, price, weight_kg, products(name)")
    .in("id", variantIds);
  if (vErr) return fail<CreateResult>(vErr.message, vErr.code);

  type VariantRow = {
    id: string;
    product_id: string;
    sku: string;
    attribute_combo: Record<string, string> | null;
    price: number;
    weight_kg: number | string | null;
    products: { name: string } | { name: string }[] | null;
  };
  const variantById = new Map<string, VariantRow>();
  for (const v of (variantRows ?? []) as VariantRow[]) variantById.set(v.id, v);

  type LinePayload = {
    product_id: string;
    variant_id: string;
    product_name: string;
    variant_label: string | null;
    sku: string;
    quantity: number;
    unit_price: number;
    total: number;
  };
  const lineRows: LinePayload[] = [];
  let subtotal = 0;
  let totalWeightKg = 0;

  // Resolve all variant labels in one batched lookup.
  const combos = parsed.data.items.map((it) => {
    const v = variantById.get(it.variant_id);
    return (v?.attribute_combo as Record<string, string> | null | undefined) ?? null;
  });
  const variantLabels = await resolveComboLabels(admin, combos);

  for (let i = 0; i < parsed.data.items.length; i++) {
    const it = parsed.data.items[i];
    const v = variantById.get(it.variant_id);
    if (!v) {
      return fail<CreateResult>(`Variant not found: ${it.variant_id}`, "VARIANT_NOT_FOUND");
    }
    const product = Array.isArray(v.products) ? v.products[0] : v.products;
    const unitPrice = it.unit_price ?? Number(v.price);
    const lineTotal = Math.round(unitPrice * it.quantity * 100) / 100;
    lineRows.push({
      product_id: v.product_id,
      variant_id: v.id,
      product_name: product?.name ?? "(unknown)",
      variant_label: variantLabels[i],
      sku: v.sku,
      quantity: it.quantity,
      unit_price: unitPrice,
      total: lineTotal,
    });
    subtotal = Math.round((subtotal + lineTotal) * 100) / 100;
    totalWeightKg += (Number(v.weight_kg ?? 0) || 0) * it.quantity;
  }

  // Resolve fees via the rules engine. Admin manual orders use the same
  // pricing path as customer self-checkout — keeping shipping/COD/etc.
  // consistent across channels. The form's `shipping_amount` input is now
  // ignored; the resolver is the source of truth. Discount + tax stay as
  // explicit form inputs since they're separate concerns from fees.
  const productIds = Array.from(new Set(lineRows.map((l) => l.product_id)));
  const uniqueVariantIds = Array.from(new Set(lineRows.map((l) => l.variant_id)));
  let categoryIds: string[] = [];
  if (productIds.length > 0) {
    const { data: pcRows } = await admin
      .from("product_categories")
      .select("category_id")
      .in("product_id", productIds);
    categoryIds = Array.from(
      new Set(((pcRows ?? []) as Array<{ category_id: string }>).map((r) => r.category_id))
    );
  }
  const recipientZip = String(
    (parsed.data.shipping_address as { postal_code?: string } | undefined)?.postal_code ?? ""
  ).trim();
  const recipientCountry = String(
    (parsed.data.shipping_address as { country_code?: string } | undefined)?.country_code ?? "GR"
  ).toUpperCase() || "GR";

  const feeResult = await resolveFees({
    payment_method: parsed.data.payment_method,
    delivery_method: parsed.data.delivery_method,
    carrier:
      parsed.data.delivery_method === "store_pickup"
        ? null
        : (parsed.data.carrier ?? null),
    subtotal,
    cod_amount: subtotal,
    product_ids: productIds,
    variant_ids: uniqueVariantIds,
    category_ids: categoryIds,
    recipient_zipcode: recipientZip || undefined,
    recipient_country: recipientCountry,
    weight_kg: totalWeightKg,
    item_quantity: lineRows.reduce((s, l) => s + l.quantity, 0),
  });
  const resolvedShipping =
    feeResult.fees_breakdown.find((e) => e.category_slug === "shipping")?.charged ?? 0;

  const total =
    Math.round(
      (subtotal -
        parsed.data.discount_amount +
        feeResult.fees_total +
        parsed.data.tax_amount) * 100
    ) / 100;

  if (total < 0) {
    return fail<CreateResult>(
      "Order total cannot be negative — discount exceeds subtotal",
      "INVALID_INPUT"
    );
  }

  const fulfillmentStatus = parsed.data.as_draft ? "draft" : "pending";
  const orderPayload = {
    customer_id: customer.id,
    customer_name_at_order: customerNameAtOrder,
    customer_email_at_order: customer.email,
    customer_phone_at_order: customer.phone,
    payment_method: parsed.data.payment_method,
    delivery_method: parsed.data.delivery_method,
    carrier: parsed.data.carrier ?? null,
    source: parsed.data.source,
    payment_status: "pending" as const,
    fulfillment_status: fulfillmentStatus as "draft" | "pending",
    created_by: authData.user.id,
    currency: parsed.data.currency,
    subtotal,
    discount_amount: parsed.data.discount_amount,
    shipping_amount: resolvedShipping,
    tax_amount: parsed.data.tax_amount,
    fees_total: feeResult.fees_total,
    fees_breakdown: feeResult.fees_breakdown,
    total,
    shipping_address: parsed.data.shipping_address ?? null,
    billing_address: parsed.data.billing_address ?? null,
    notes: parsed.data.notes ?? null,
  };

  const { data: orderRow, error: orderErr } = await admin
    .from("orders")
    .insert(orderPayload)
    .select("id, order_number")
    .single();
  if (orderErr || !orderRow) {
    return fail<CreateResult>(orderErr?.message ?? "Could not create order", orderErr?.code);
  }
  const order = orderRow as { id: string; order_number: string };

  // Bulk-insert order_items.
  const linesWithOrderId = lineRows.map((r) => ({ ...r, order_id: order.id }));
  const { error: linesErr } = await admin.from("order_items").insert(linesWithOrderId);
  if (linesErr) {
    await admin.from("orders").delete().eq("id", order.id);
    return fail<CreateResult>(`Could not insert items: ${linesErr.message}`, linesErr.code);
  }

  // Reserve inventory in ONE atomic batch (non-Stripe + not draft). Either
  // all lines reserve or NONE — no more "partial reservation" half-state
  // that the legacy per-line loop could produce. Phase 2 of the data-layer
  // remediation.
  if (!parsed.data.as_draft) {
    const { error: rErr } = await admin.rpc("reserve_inventory_batch" as never, {
      p_lines: lineRows.map((r) => ({
        variant_id: r.variant_id,
        qty: r.quantity,
      })),
    } as never);
    if (rErr) {
      await admin
        .from("orders")
        .update({
          notes:
            (parsed.data.notes ? parsed.data.notes + "\n\n" : "") +
            `[ΠΡΟΣΟΧΗ] Αποτυχία δέσμευσης αποθέματος: ${rErr.message}. Καμία γραμμή δεν δεσμεύθηκε (atomic batch).`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id);
      await logAuditEvent({
        actor_id: authData.user.id,
        actor_type: "user",
        action: "order.created_reservation_failed",
        resource_type: "order",
        resource_id: order.id,
        metadata: {
          reason: rErr.message,
          sqlstate: rErr.code,
        },
      });
      return fail<CreateResult>(
        `Δημιουργήθηκε χωρίς δέσμευση αποθέματος. Παραγγελία ${order.order_number}: ${rErr.message}`,
        rErr.code
      );
    }
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: parsed.data.as_draft ? "order.draft_created" : "order.created_manual",
    resource_type: "order",
    resource_id: order.id,
    metadata: {
      order_number: order.order_number,
      customer_id: customer.id,
      source: parsed.data.source,
      payment_method: parsed.data.payment_method,
      delivery_method: parsed.data.delivery_method,
      total,
      item_count: lineRows.length,
    },
  });

  revalidatePath("/admin/orders");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/customers");
  return ok({ order_id: order.id, order_number: order.order_number });
}
