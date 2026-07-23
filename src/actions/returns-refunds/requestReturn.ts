"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/transactional-emails";
import { checkRateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit-log";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().min(10).max(2000),
  items: z
    .array(
      z.object({
        orderItemId: z.string().uuid(),
        quantity: z.number().int().positive(),
        reason: z.string().max(500).optional(),
      })
    )
    .min(1),
});

export async function requestReturn(
  input: z.infer<typeof Schema>
): Promise<Result<{ returnId: string }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<{ returnId: string }>("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<{ returnId: string }>("Not authenticated", "UNAUTHENTICATED");
  const userId = authData.user.id;

  // Per-user rate limit. Returns aren't time-critical and the action sends
  // an email + creates admin queue work; 3 per hour is more than enough
  // for a legitimate customer dealing with one delivery.
  const rl = await checkRateLimit({
    key: `return-request:${userId}`,
    limit: 3,
    windowMs: 60 * 60_000,
  });
  if (!rl.allowed) {
    return fail<{ returnId: string }>(
      "Πολλές αιτήσεις επιστροφής — δοκιμάστε ξανά αργότερα.",
      "RATE_LIMITED"
    );
  }

  // Verify the order belongs to the user.
  const { data: order } = await supabase
    .from("orders")
    .select("id, user_id, status, order_number")
    .eq("id", parsed.data.orderId)
    .maybeSingle();

  if (!order || (order as any).user_id !== userId) {
    return fail<{ returnId: string }>("Order not found", "ORDER_NOT_FOUND");
  }

  const { data: req, error } = await supabase
    .from("return_requests")
    .insert({
      order_id: parsed.data.orderId,
      user_id: userId,
      reason: parsed.data.reason,
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !req) return fail<{ returnId: string }>(error?.message ?? "Insert failed", error?.code);
  const returnId = (req as any).id as string;

  // Insert items via authenticated client (RLS allows because user owns parent).
  const itemRows = parsed.data.items.map((it) => ({
    return_id: returnId,
    order_item_id: it.orderItemId,
    quantity: it.quantity,
    reason: it.reason ?? null,
  }));
  await supabase.from("return_items").insert(itemRows);

  // Notify customer.
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  if (profile) {
    await sendEmail({
      to: (profile as any).email,
      subject: `Αίτηση επιστροφής — ${(order as any).order_number}`,
      text: "Λάβαμε την αίτηση επιστροφής σας και θα την εξετάσουμε σύντομα.",
      templateId: "return.requested",
    });
  }

  await logAuditEvent({
    actor_id: userId,
    actor_type: "user",
    action: "returns.requested",
    resource_type: "return_request",
    resource_id: returnId,
    metadata: {
      order_id: parsed.data.orderId,
      item_count: parsed.data.items.length,
    },
  });

  return ok({ returnId });
}
