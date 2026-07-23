"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { loadCarrierProvider } from "@/lib/courier/registry";
import { getCapabilities } from "@/lib/courier/getCapabilities";
import { isBuiltInCarrier } from "@/config/carrier-slugs";
import type { Carrier } from "@/types/order-history";
import type { VoucherContext } from "@/lib/courier/provider";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  order_id: z.string().uuid(),
});

interface CreateVoucherResult {
  voucher_number: string;
}

/**
 * Phase 8 — creates a voucher with the order's carrier via the provider's
 * createVoucher method. Writes the returned voucher number back as
 * orders.tracking_number and advances fulfillment_status to 'label_created'.
 *
 * Idempotent at the action layer: if the order already has a tracking
 * number, the call is rejected with VOUCHER_EXISTS rather than creating
 * a duplicate at the carrier. Admin would need to cancel the existing
 * voucher first (via cancelCarrierVoucher) before re-creating.
 *
 * Permission: manage:orders.
 * Capability check: the carrier's create_voucher capability must be ON.
 */
export async function createCarrierVoucher(
  input: z.input<typeof Schema>
): Promise<Result<CreateVoucherResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail("Συνδεθείτε για να συνεχίσετε.", "UNAUTHENTICATED");
  if (!(await checkPermission("manage:orders"))) {
    return fail("Δεν έχετε δικαίωμα διαχείρισης παραγγελιών.", "FORBIDDEN");
  }

  const admin = createAdminClient();
  const { data: orderRow, error: orderErr } = await admin
    .from("orders")
    .select(
      "id, order_number, carrier, carrier_slug, delivery_method, tracking_number, " +
        "customer_name_at_order, customer_phone_at_order, customer_email_at_order, " +
        "shipping_address, fulfillment_status, currency, total, " +
        "pickup_carrier, pickup_station_id, pickup_branch_id, pickup_type"
    )
    .eq("id", parsed.data.order_id)
    .maybeSingle();
  if (orderErr || !orderRow) {
    return fail("Η παραγγελία δεν βρέθηκε.", "NOT_FOUND");
  }
  type OrderRow = {
    id: string;
    order_number: string;
    carrier: Carrier | null;
    carrier_slug: string | null;
    delivery_method: "home_delivery" | "store_pickup" | "delivery_station_pickup" | "carrier_pickup";
    tracking_number: string | null;
    customer_name_at_order: string | null;
    customer_phone_at_order: string | null;
    customer_email_at_order: string | null;
    shipping_address: Record<string, unknown> | null;
    fulfillment_status: string;
    currency: string;
    total: number;
    pickup_carrier: string | null;
    pickup_station_id: string | null;
    pickup_branch_id: number | null;
    pickup_type: "locker" | "branch" | null;
  };
  const order = orderRow as unknown as OrderRow;

  if (order.tracking_number) {
    return fail<CreateVoucherResult>(
      "Η παραγγελία έχει ήδη voucher. Ακυρώστε το πρώτα για να δημιουργήσετε νέο.",
      "VOUCHER_EXISTS"
    );
  }
  if (order.delivery_method === "store_pickup") {
    return fail<CreateVoucherResult>(
      "Η παραλαβή από το κατάστημα δεν χρειάζεται voucher μεταφορικής.",
      "VOUCHER_NOT_APPLICABLE"
    );
  }
  const carrierSlug = order.carrier_slug ?? order.carrier;
  if (!carrierSlug) {
    return fail<CreateVoucherResult>(
      "Η παραγγελία δεν έχει μεταφορική.",
      "NO_CARRIER"
    );
  }

  // Capability gate. If the admin disabled create_voucher for this carrier,
  // refuse rather than calling the API — matches the "merchant prefers
  // manual voucher creation" workflow without surprising errors.
  const capabilities = await getCapabilities(carrierSlug);
  if (!capabilities.has("create_voucher")) {
    return fail<CreateVoucherResult>(
      "Η μεταφορική δεν είναι ρυθμισμένη για αυτόματη δημιουργία voucher.",
      "CAPABILITY_DISABLED"
    );
  }

  // loadCarrierProvider expects the narrow Carrier literal union. For
  // custom carriers (no provider class), this will return null gracefully.
  if (!isBuiltInCarrier(carrierSlug)) {
    return fail<CreateVoucherResult>(
      "Η μεταφορική δεν έχει αυτόματη ενσωμάτωση. Δημιουργήστε το voucher χειροκίνητα.",
      "PROVIDER_UNAVAILABLE"
    );
  }
  const provider = await loadCarrierProvider(carrierSlug as Carrier);
  if (!provider) {
    return fail<CreateVoucherResult>(
      "Η μεταφορική δεν είναι ρυθμισμένη ή τα credentials δεν είναι έγκυρα.",
      "PROVIDER_UNAVAILABLE"
    );
  }

  // Build the voucher context. Shipping address fields come from the
  // snapshotted shipping_address JSON on the order — they don't change
  // even if the customer's saved address record is later edited.
  type Addr = {
    street?: string | null;
    address_line2?: string | null;
    city?: string | null;
    postal_code?: string | null;
    country_code?: string | null;
    phone?: string | null;
  };
  const addr = (order.shipping_address ?? {}) as Addr;
  const ctx: VoucherContext = {
    order_id: order.id,
    order_number: order.order_number,
    recipient_name: order.customer_name_at_order ?? "",
    recipient_address: addr.street ?? "",
    recipient_zipcode: addr.postal_code ?? "",
    recipient_region: addr.city ?? undefined,
    recipient_country: addr.country_code ?? "GR",
    recipient_phone: order.customer_phone_at_order,
    recipient_cellphone: order.customer_phone_at_order,
    recipient_email: order.customer_email_at_order,
    weight_kg: 1, // TODO Phase 11: derive from order items' weights
    item_quantity: 1, // Single-parcel for now (ADR-7)
    pickup_type: order.pickup_type,
    pickup_station_id: order.pickup_station_id,
    pickup_branch_id: order.pickup_branch_id,
  };

  try {
    const voucher = await provider.createVoucher(ctx);
    const now = new Date().toISOString();
    await admin
      .from("orders")
      .update({
        tracking_number: voucher.voucher_number,
        fulfillment_status: "label_created",
        status_set_by: "merchant",
        carrier_status_updated_at: now,
        updated_at: now,
      })
      .eq("id", order.id);

    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "order.voucher_created",
      resource_type: "order",
      resource_id: order.id,
      metadata: {
        order_number: order.order_number,
        carrier: carrierSlug,
        voucher_number: voucher.voucher_number,
        pickup_type: order.pickup_type,
        pickup_station_id: order.pickup_station_id,
      },
    });

    revalidatePath(`/admin/orders/${order.id}`);
    revalidatePath(`/orders/${order.id}`);

    return ok({ voucher_number: voucher.voucher_number });
  } catch (e) {
    const msg = (e as Error).message || "Σφάλμα κατά τη δημιουργία voucher.";
    console.error("[createCarrierVoucher] failed:", msg);
    return fail<CreateVoucherResult>(msg, "PROVIDER_ERROR");
  }
}
