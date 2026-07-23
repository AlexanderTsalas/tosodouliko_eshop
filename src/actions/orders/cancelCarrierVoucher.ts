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
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  order_id: z.string().uuid(),
});

/**
 * Phase 8 — cancels a previously-created voucher via the carrier's API.
 *
 * On success, clears orders.tracking_number so the order can be re-vouchered
 * if needed (e.g., address correction → cancel → recreate). The
 * fulfillment_status is NOT auto-reverted from 'label_created' — the admin
 * can use the existing status transition controls to move back to
 * 'preparing' or 'cancelled' as appropriate.
 *
 * Per ACS docs, cancellation works only before the voucher is in a pickup
 * list. The provider returns ok:false with a message if cancellation isn't
 * possible — we surface that message to the admin verbatim.
 *
 * Permission: manage:orders.
 * Capability: cancel_voucher must be ON for the carrier.
 */
export async function cancelCarrierVoucher(
  input: z.input<typeof Schema>
): Promise<Result<{ orderId: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail("Συνδεθείτε για να συνεχίσετε.", "UNAUTHENTICATED");
  if (!(await checkPermission("manage:orders"))) {
    return fail("Δεν έχετε δικαίωμα διαχείρισης παραγγελιών.", "FORBIDDEN");
  }

  const admin = createAdminClient();
  const { data: orderRow } = await admin
    .from("orders")
    .select("id, order_number, carrier, carrier_slug, tracking_number")
    .eq("id", parsed.data.order_id)
    .maybeSingle();
  if (!orderRow) return fail("Η παραγγελία δεν βρέθηκε.", "NOT_FOUND");
  const order = orderRow as {
    id: string;
    order_number: string;
    carrier: string | null;
    carrier_slug: string | null;
    tracking_number: string | null;
  };

  if (!order.tracking_number) {
    return fail<{ orderId: string }>(
      "Η παραγγελία δεν έχει voucher για ακύρωση.",
      "NO_VOUCHER"
    );
  }
  const carrierSlug = order.carrier_slug ?? order.carrier;
  if (!carrierSlug) {
    return fail<{ orderId: string }>("Η παραγγελία δεν έχει μεταφορική.", "NO_CARRIER");
  }

  const capabilities = await getCapabilities(carrierSlug);
  if (!capabilities.has("cancel_voucher")) {
    return fail<{ orderId: string }>(
      "Η μεταφορική δεν είναι ρυθμισμένη για ακύρωση voucher μέσω API.",
      "CAPABILITY_DISABLED"
    );
  }

  if (!isBuiltInCarrier(carrierSlug)) {
    return fail<{ orderId: string }>(
      "Η μεταφορική δεν έχει ενσωμάτωση API.",
      "PROVIDER_UNAVAILABLE"
    );
  }
  const provider = await loadCarrierProvider(carrierSlug as Carrier);
  if (!provider) {
    return fail<{ orderId: string }>(
      "Η μεταφορική δεν είναι ρυθμισμένη ή τα credentials δεν είναι έγκυρα.",
      "PROVIDER_UNAVAILABLE"
    );
  }

  try {
    const result = await provider.cancelVoucher(order.tracking_number);
    if (!result.ok) {
      return fail<{ orderId: string }>(
        result.message || "Η ακύρωση απέτυχε.",
        "CANCEL_FAILED"
      );
    }

    await admin
      .from("orders")
      .update({
        tracking_number: null,
        // Don't auto-revert fulfillment_status — leave that to the admin's
        // explicit transition (cancel the order entirely, or revert to
        // preparing). Just record the audit event.
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    await logAuditEvent({
      actor_id: authData.user.id,
      actor_type: "user",
      action: "order.voucher_cancelled",
      resource_type: "order",
      resource_id: order.id,
      metadata: {
        order_number: order.order_number,
        carrier: carrierSlug,
        cancelled_voucher_number: order.tracking_number,
      },
    });

    revalidatePath(`/admin/orders/${order.id}`);
    revalidatePath(`/orders/${order.id}`);

    return ok({ orderId: order.id });
  } catch (e) {
    const msg = (e as Error).message || "Σφάλμα κατά την ακύρωση voucher.";
    console.error("[cancelCarrierVoucher] failed:", msg);
    return fail<{ orderId: string }>(msg, "PROVIDER_ERROR");
  }
}
