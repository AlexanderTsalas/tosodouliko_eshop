"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/transactional-emails";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";
import type { Shipment } from "@/types/courier-integration";

const Schema = z.object({
  orderId: z.string().uuid(),
  courier: z.string().min(1),
});

/**
 * Create a shipment for an order. Calls the external courier API, persists
 * the shipment, and triggers a notification email to the customer.
 *
 * Auth: caller must have `manage:shipments`.
 */
export async function createShipment(
  input: z.infer<typeof Schema>
): Promise<Result<Shipment>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<Shipment>("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<Shipment>("Not authenticated", "UNAUTHENTICATED");

  // This action writes via the service role (bypassing RLS), so it must
  // re-check the permission in app code — otherwise it's authenticated-but-
  // not-authorized and the account_type/RLS boundary never applies.
  if (!(await checkPermission("manage:shipments"))) {
    return fail<Shipment>("Forbidden", "FORBIDDEN");
  }

  const rl = await checkRateLimit({
    key: `courier:${parsed.data.courier}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!rl.allowed) return fail<Shipment>("Rate limit exceeded", "RATE_LIMITED");

  const admin = createAdminClient();

  // TODO: real courier API call.
  let trackingNumber: string | null = null;
  const labelUrl: string | null = null;
  if (
    process.env.COURIER_API_KEY &&
    process.env.COURIER_API_URL &&
    !process.env.COURIER_API_KEY.startsWith("placeholder")
  ) {
    // const res = await fetch(`${process.env.COURIER_API_URL}/shipments`, { ... });
  } else {
    trackingNumber = `STUB-${Date.now()}`;
  }

  const { data: shipment, error } = await admin
    .from("shipments")
    .insert({
      order_id: parsed.data.orderId,
      courier: parsed.data.courier,
      tracking_number: trackingNumber,
      tracking_url: trackingNumber ? `https://example.com/track/${trackingNumber}` : null,
      status: trackingNumber ? "label_created" : "pending",
      label_url: labelUrl,
    })
    .select("*")
    .single();

  if (error || !shipment) return fail<Shipment>(error?.message ?? "Insert failed", error?.code);

  // Notify customer.
  const { data: order } = await admin
    .from("orders")
    .select("user_id, order_number")
    .eq("id", parsed.data.orderId)
    .maybeSingle();

  if (order) {
    const { data: profile } = await admin
      .from("user_profiles")
      .select("email, first_name")
      .eq("id", (order as any).user_id)
      .maybeSingle();

    if (profile) {
      await sendEmail({
        to: (profile as any).email,
        subject: `Παραγγελία ${(order as any).order_number} — Αποστολή`,
        text: `Η παραγγελία σας στάλθηκε. Tracking: ${trackingNumber ?? "—"}`,
        templateId: "shipment.created",
        templateData: { trackingNumber, courier: parsed.data.courier },
      });
    }
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "shipment.created",
    resource_type: "shipment",
    resource_id: (shipment as any).id,
    metadata: { orderId: parsed.data.orderId },
  });

  return ok(shipment as unknown as Shipment);
}
