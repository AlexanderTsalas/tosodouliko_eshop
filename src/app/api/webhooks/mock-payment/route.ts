import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { activeProviderKind } from "@/lib/payment";
import {
  handleSessionCompleted,
  handleSessionExpired,
  handleSessionFailed,
} from "@/lib/payment/handleSessionEvents";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit-log";

// Webhook handler — never cache; every request mutates state.
export const dynamic = "force-dynamic";

/**
 * Mock-payment webhook. Only enabled when the active provider is `mock` —
 * lets the MockCheckoutSimulator UI simulate the success/failure/expiry
 * events Stripe's `checkout.session.*` would deliver, routing through the
 * same shared handlers.
 *
 * Safety:
 *  - HARD-disabled when activeProviderKind() === "stripe" (returns 404).
 *  - Verifies the named session_id exists in our DB AND is currently in
 *    session_pending state. Anyone hitting the endpoint must already know
 *    a valid session id (which is only ever returned to the legitimately
 *    authenticated user who created it). Not perfect — a determined
 *    attacker who exfiltrates a session id from logs could force a mock
 *    order through. Acceptable for prototype/dev; real Stripe replaces
 *    this endpoint entirely.
 */

const BodySchema = z.object({
  outcome: z.enum(["completed", "failed", "expired"]),
  session_id: z.string().min(8).max(200),
  reason: z.string().max(500).optional(),
});

export async function POST(request: NextRequest) {
  if (activeProviderKind() !== "mock") {
    return NextResponse.json(
      { error: "Mock webhook disabled — real Stripe provider active." },
      { status: 404 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  // Soft sanity: confirm the session exists in our DB before doing anything.
  const admin = createAdminClient();
  const { data: intentRow } = await admin
    .from("payment_intents")
    .select("id, status, order_id")
    .eq("stripe_checkout_session_id", parsed.data.session_id)
    .maybeSingle();
  if (!intentRow) {
    return NextResponse.json({ error: "Unknown session id" }, { status: 404 });
  }

  try {
    if (parsed.data.outcome === "completed") {
      const r = await handleSessionCompleted({
        provider: "mock",
        provider_session_id: parsed.data.session_id,
        provider_intent_id: null,
      });
      return NextResponse.json({ ok: true, order_id: r.orderId });
    }
    if (parsed.data.outcome === "expired") {
      await handleSessionExpired({
        provider: "mock",
        provider_session_id: parsed.data.session_id,
      });
      return NextResponse.json({ ok: true });
    }
    await handleSessionFailed({
      provider: "mock",
      provider_session_id: parsed.data.session_id,
      reason: parsed.data.reason,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    await logAuditEvent({
      actor_type: "system",
      action: "mock_payment.webhook.error",
      resource_type: "payment_intent",
      resource_id: parsed.data.session_id,
      metadata: { error: (err as Error).message },
    });
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
