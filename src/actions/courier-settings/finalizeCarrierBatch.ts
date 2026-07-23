"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { loadCarrierProvider } from "@/lib/courier/registry";
import { getCapabilities } from "@/lib/courier/getCapabilities";
import { isBuiltInCarrier } from "@/config/carrier-slugs";
import type { Carrier } from "@/types/order-history";
import type { FinalizeBatchResult } from "@/lib/courier/provider";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  carrier: z.string().max(50),
});

interface FinalizeResultDTO {
  carrier: string;
  ok: boolean;
  batch_id: string | null;
  voucher_count: number | null;
  message: string | null;
}

/**
 * Phase 8b — closes the daily voucher batch for a single carrier (ACS
 * Issue_Pickup_List / Geniki ClosePendingJobs). Called from the
 * /admin/operations/daily-handoff page once the merchant has stopped
 * creating new vouchers for the day.
 *
 * Gated by:
 *   - manage:couriers permission
 *   - batch_finalize capability ON for the carrier
 *   - carrier is a built-in with an active provider config
 *
 * Audit-logs the call regardless of outcome so the merchant has a
 * traceable record of when each batch was closed.
 */
export async function finalizeCarrierBatch(
  input: z.input<typeof Schema>
): Promise<Result<FinalizeResultDTO>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail("Συνδεθείτε για να συνεχίσετε.", "UNAUTHENTICATED");
  if (!(await checkPermission("manage:couriers"))) {
    return fail("Δεν έχετε δικαίωμα διαχείρισης μεταφορικών.", "FORBIDDEN");
  }

  const carrierSlug = parsed.data.carrier;
  const capabilities = await getCapabilities(carrierSlug);
  if (!capabilities.has("batch_finalize")) {
    return fail<FinalizeResultDTO>(
      "Η μεταφορική δεν υποστηρίζει αυτόματο κλείσιμο παρτίδας.",
      "CAPABILITY_DISABLED"
    );
  }

  if (!isBuiltInCarrier(carrierSlug)) {
    return fail<FinalizeResultDTO>(
      "Η μεταφορική δεν έχει ενσωμάτωση API.",
      "PROVIDER_UNAVAILABLE"
    );
  }
  const provider = await loadCarrierProvider(carrierSlug as Carrier);
  if (!provider) {
    return fail<FinalizeResultDTO>(
      "Δεν υπάρχει ενεργή ρύθμιση μεταφορικής.",
      "PROVIDER_UNAVAILABLE"
    );
  }

  let result: FinalizeBatchResult;
  try {
    result = await provider.finalizeBatch();
  } catch (e) {
    const msg = (e as Error).message || "Σφάλμα κατά το κλείσιμο παρτίδας.";
    return fail<FinalizeResultDTO>(msg, "PROVIDER_ERROR");
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: result.ok ? "courier.batch_finalized" : "courier.batch_finalize_failed",
    resource_type: "carrier_provider",
    resource_id: carrierSlug,
    metadata: {
      carrier: carrierSlug,
      batch_id: result.batch_id ?? null,
      voucher_count: result.voucher_count ?? null,
      message: result.message ?? null,
    },
  });

  // Revalidate operations + admin pages so any "last closed at" / pending-
  // batch counters refresh.
  revalidatePath("/admin/operations/daily-handoff");
  revalidatePath("/admin/orders");

  if (!result.ok) {
    return fail<FinalizeResultDTO>(
      result.message || "Το κλείσιμο παρτίδας απέτυχε.",
      "FINALIZE_FAILED"
    );
  }

  return ok({
    carrier: carrierSlug,
    ok: true,
    batch_id: result.batch_id ?? null,
    voucher_count: result.voucher_count ?? null,
    message: null,
  });
}
