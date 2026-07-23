import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit-log";

// Per-request state mutation (releases held inventory + soft session).
// Never cache.
export const dynamic = "force-dynamic";

/**
 * Explicit soft-session release endpoint. Currently unused by the customer
 * checkout flow — the abandoned-page beacon path was removed after testing
 * confirmed no browser event can cleanly distinguish refresh from close
 * (see CheckoutSessionGuard.tsx for the full rationale). Heartbeat
 * staleness is the sole release signal for abandoned sessions now.
 *
 * Kept on disk because Phase 10 admin force-release tooling will call the
 * same `release_soft_session` RPC through this exact route — auth +
 * ownership check + RPC call shape is already correct for that use.
 *
 * Idempotent on every axis:
 *  - Missing session → 200 ok (already gone)
 *  - Non-soft state → 200 ok (already released or promoted)
 *  - Foreign customer → 403 (defense in depth)
 */

const BodySchema = z.object({
  session_id: z.string().uuid(),
});

export async function POST(request: NextRequest) {
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

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: custRow } = await admin
    .from("customers")
    .select("id")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  const customerId = (custRow as { id: string } | null)?.id ?? null;
  if (!customerId) {
    return NextResponse.json({ error: "No customer profile" }, { status: 403 });
  }

  const { data: sessionRow } = await admin
    .from("cart_checkout_sessions")
    .select("id, customer_id, state")
    .eq("id", parsed.data.session_id)
    .maybeSingle();
  const session = sessionRow as
    | { id: string; customer_id: string; state: string }
    | null;
  if (!session) {
    return NextResponse.json({ ok: true, released: false });
  }
  if (session.customer_id !== customerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (session.state !== "soft") {
    return NextResponse.json({ ok: true, released: false });
  }

  const { data: rpcRes, error } = await admin.rpc(
    "release_soft_session" as never,
    { p_session_id: parsed.data.session_id } as never
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "checkout.session.released",
    resource_type: "cart_checkout_session",
    resource_id: parsed.data.session_id,
    metadata: { reason: "client_unload" },
  });

  return NextResponse.json({ ok: true, released: Boolean(rpcRes) });
}
