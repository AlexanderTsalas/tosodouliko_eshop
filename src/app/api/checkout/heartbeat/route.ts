import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Per-request state mutation (touches last_heartbeat_at). Never cache.
export const dynamic = "force-dynamic";

/**
 * Heartbeat endpoint. The /checkout page POSTs here every ~10s while alive.
 * Updates `last_heartbeat_at` on the customer's soft session.
 *
 * Heartbeat is the sole liveness signal — the abandoned-page beacon path
 * was removed after testing confirmed no browser event can cleanly
 * distinguish refresh from close on the outgoing page (Chrome's Navigation
 * API `navigate` event does not fire on cross-document F5 by spec design).
 *
 * Drop-off behavior:
 *  - `release_stale_heartbeat_sessions` cron releases sessions silent >30s
 *    (runs every minute).
 *  - `cleanup_expired_sessions_for_variant` (called inline by `hold_soft`
 *    and `effective_available_for`) catches stale-heartbeat sessions
 *    instantly for contended variants, so the next customer doesn't wait
 *    for the cron tick.
 *
 * Hot path. Keep the work minimal — auth, ownership check, single UPDATE.
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

  // Update is guarded by both ownership AND state='soft' — promoted ('hard')
  // and terminal ('released', 'completed') sessions silently no-op.
  const { error } = await admin
    .from("cart_checkout_sessions")
    .update({ last_heartbeat_at: new Date().toISOString() })
    .eq("id", parsed.data.session_id)
    .eq("customer_id", customerId)
    .eq("state", "soft");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
