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
import type { StatusCode } from "@/config/status-vocabulary";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  order_id: z.string().uuid(),
});

interface RefreshResult {
  status: StatusCode;
  carrier_raw_status: string | null;
  carrier_status_label: string | null;
  carrier_status_updated_at: string;
}

/**
 * Phase 8b — pulls the latest tracking summary for a single order from the
 * carrier API and updates the corresponding `orders.*` fields. Used by the
 * "Ανανέωση tracking" button on the admin order page.
 *
 * Persists:
 *   - fulfillment_status     ← provider's mapped StatusCode
 *   - carrier_raw_status     ← carrier-native composite (for audit detail)
 *   - carrier_status_label   ← carrier's human-readable status text
 *   - carrier_status_updated_at ← now()
 *   - status_set_by          ← 'api' (this came from the API call, not the admin)
 *
 * The 'collected' vs 'delivered' distinction: ACS's
 * mapAcsShipmentStatus returns `delivered` whenever the package was handed
 * over, regardless of door-vs-pickup. If the order's pickup_type indicates
 * a locker/branch pickup AND the provider returned `delivered`, we
 * overwrite to `collected` for accurate customer messaging.
 *
 * Gated by:
 *   - manage:orders permission
 *   - fetch_tracking capability ON for the carrier
 *   - order has a tracking_number
 */
export async function refreshOrderTracking(
  input: z.input<typeof Schema>
): Promise<Result<RefreshResult>> {
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
    .select(
      "id, order_number, carrier, carrier_slug, tracking_number, pickup_type"
    )
    .eq("id", parsed.data.order_id)
    .maybeSingle();
  if (!orderRow) return fail<RefreshResult>("Η παραγγελία δεν βρέθηκε.", "NOT_FOUND");
  const order = orderRow as unknown as {
    id: string;
    order_number: string;
    carrier: string | null;
    carrier_slug: string | null;
    tracking_number: string | null;
    pickup_type: "locker" | "branch" | null;
  };

  if (!order.tracking_number) {
    return fail<RefreshResult>(
      "Η παραγγελία δεν έχει tracking number για ανανέωση.",
      "NO_TRACKING_NUMBER"
    );
  }
  const carrierSlug = order.carrier_slug ?? order.carrier;
  if (!carrierSlug) {
    return fail<RefreshResult>("Η παραγγελία δεν έχει μεταφορική.", "NO_CARRIER");
  }

  const capabilities = await getCapabilities(carrierSlug);
  if (!capabilities.has("fetch_tracking")) {
    return fail<RefreshResult>(
      "Η μεταφορική δεν είναι ρυθμισμένη για αυτόματο tracking.",
      "CAPABILITY_DISABLED"
    );
  }

  if (!isBuiltInCarrier(carrierSlug)) {
    return fail<RefreshResult>(
      "Η μεταφορική δεν έχει ενσωμάτωση API.",
      "PROVIDER_UNAVAILABLE"
    );
  }
  const provider = await loadCarrierProvider(carrierSlug as Carrier);
  if (!provider) {
    return fail<RefreshResult>(
      "Δεν υπάρχει ενεργή ρύθμιση μεταφορικής.",
      "PROVIDER_UNAVAILABLE"
    );
  }

  let tracking;
  try {
    tracking = await provider.trackingSummary(order.tracking_number);
  } catch (e) {
    const msg = (e as Error).message || "Σφάλμα κατά την ανανέωση tracking.";
    return fail<RefreshResult>(msg, "PROVIDER_ERROR");
  }

  // collected-vs-delivered override (per the design doc): the provider can't
  // know whether 'delivered' meant door delivery or pickup-point collection
  // without knowing the order's pickup_type. We know it, so we correct.
  let finalStatus: StatusCode = tracking.status;
  if (
    tracking.status === "delivered" &&
    (order.pickup_type === "locker" || order.pickup_type === "branch")
  ) {
    finalStatus = "collected";
  }

  const now = new Date().toISOString();
  const { error: updErr } = await admin
    .from("orders")
    .update({
      fulfillment_status: finalStatus,
      carrier_raw_status: tracking.raw_status,
      carrier_status_label: tracking.status_label,
      carrier_status_updated_at: now,
      status_set_by: "api",
      updated_at: now,
    })
    .eq("id", order.id);
  if (updErr) {
    return fail<RefreshResult>(updErr.message, "DB_ERROR");
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "order.tracking_refreshed",
    resource_type: "order",
    resource_id: order.id,
    metadata: {
      order_number: order.order_number,
      carrier: carrierSlug,
      tracking_number: order.tracking_number,
      new_status: finalStatus,
      carrier_raw_status: tracking.raw_status,
      event_count: tracking.events.length,
    },
  });

  revalidatePath(`/admin/orders/${order.id}`);
  revalidatePath(`/orders/${order.id}`);

  return ok({
    status: finalStatus,
    carrier_raw_status: tracking.raw_status,
    carrier_status_label: tracking.status_label,
    carrier_status_updated_at: now,
  });
}
