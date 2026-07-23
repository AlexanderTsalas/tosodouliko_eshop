"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveComboLabels } from "@/lib/variants/resolveComboLabel";
import { ok, type Result } from "@/types/result";

export interface NextInLineRow {
  soft_wait_id: string;
  checkout_session_id: string;
  variant_id: string;
  product_id: string;
  product_name: string;
  product_slug: string;
  variant_label: string | null;
  /** Position 1 = next promotion candidate. Higher = further back. */
  queue_position: number;
  /** Holder session's expires_at (already +5min if detoured). NULL = uncontended (no deadline). */
  session_expires_at: string | null;
  /** True iff the holder has detoured for signup (cart_checkout_sessions.signup_detour_at set). */
  signup_detour_active: boolean;
}

/**
 * Returns every pending soft_wait the calling customer has, enriched with
 * their per-row queue_position and the holder's session timer state. The
 * client-side SoftWaitNextInLineWatcher polls this on Realtime changes to
 * drive:
 *   - modal pop on the 2+ → 1 transition (with persistence so it doesn't
 *     re-fire on every refresh)
 *   - bottom-right floating timer widget while queue_position === 1
 *   - banner copy when signup_detour_active is true ("Ο πελάτης κάνει
 *     εγγραφή — λίγο ακόμη")
 *
 * Uses the admin client for cross-customer joins (other waiters' rows are
 * not visible via RLS) but only returns rows belonging to the caller.
 */
export async function getNextInLineState(): Promise<Result<NextInLineRow[]>> {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return ok([]);

  const admin = createAdminClient();
  const { data: custRow } = await admin
    .from("customers")
    .select("id")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  const customerId = (custRow as { id: string } | null)?.id ?? null;
  if (!customerId) return ok([]);

  // My pending soft_wait rows (not yet promoted).
  const { data: myWaitsRaw } = await admin
    .from("soft_waits")
    .select(
      "id, checkout_session_id, variant_id, created_at, product_variants(attribute_combo, product_id, products(id, name, slug))"
    )
    .eq("customer_id", customerId)
    .is("promoted_at", null)
    .order("created_at", { ascending: true });

  type WaitJoin = {
    id: string;
    checkout_session_id: string;
    variant_id: string;
    created_at: string;
    product_variants:
      | {
          attribute_combo: Record<string, string> | null;
          product_id: string;
          products:
            | { id: string; name: string; slug: string }
            | { id: string; name: string; slug: string }[]
            | null;
        }
      | {
          attribute_combo: Record<string, string> | null;
          product_id: string;
          products:
            | { id: string; name: string; slug: string }
            | { id: string; name: string; slug: string }[]
            | null;
        }[]
      | null;
  };
  const waits = (myWaitsRaw ?? []) as unknown as WaitJoin[];
  if (waits.length === 0) return ok([]);

  // Compute queue_position per row. The bucket is (session, variant); rank
  // by created_at among non-promoted rows.
  const sessionIds = Array.from(new Set(waits.map((w) => w.checkout_session_id)));
  const variantIds = Array.from(new Set(waits.map((w) => w.variant_id)));

  const [{ data: bucketRowsRaw }, { data: sessRowsRaw }] = await Promise.all([
    admin
      .from("soft_waits")
      .select("id, checkout_session_id, variant_id, created_at")
      .in("checkout_session_id", sessionIds)
      .in("variant_id", variantIds)
      .is("promoted_at", null)
      .order("created_at", { ascending: true }),
    admin
      .from("cart_checkout_sessions")
      .select("id, expires_at, signup_detour_at, state")
      .in("id", sessionIds),
  ]);
  type BucketRow = {
    id: string;
    checkout_session_id: string;
    variant_id: string;
    created_at: string;
  };
  const buckets = (bucketRowsRaw ?? []) as BucketRow[];

  const positionByMyId = new Map<string, number>();
  for (const myWait of waits) {
    const ahead = buckets.filter(
      (b) =>
        b.checkout_session_id === myWait.checkout_session_id &&
        b.variant_id === myWait.variant_id &&
        b.created_at < myWait.created_at
    ).length;
    positionByMyId.set(myWait.id, ahead + 1);
  }

  type SessRow = {
    id: string;
    expires_at: string | null;
    signup_detour_at: string | null;
    state: string;
  };
  const sessions = new Map(
    ((sessRowsRaw ?? []) as SessRow[]).map((s) => [s.id, s])
  );

  // Resolve variant labels in one batch.
  const combos = waits.map((w) => {
    const variantData = Array.isArray(w.product_variants)
      ? w.product_variants[0]
      : w.product_variants;
    return variantData?.attribute_combo ?? null;
  });
  const labels = await resolveComboLabels(admin, combos);

  const out: NextInLineRow[] = [];
  for (let i = 0; i < waits.length; i++) {
    const w = waits[i];
    const variantData = Array.isArray(w.product_variants)
      ? w.product_variants[0]
      : w.product_variants;
    const product = variantData?.products
      ? Array.isArray(variantData.products)
        ? variantData.products[0]
        : variantData.products
      : null;
    if (!product) continue;
    const sess = sessions.get(w.checkout_session_id);
    // If the session is no longer in soft state, the row is effectively
    // resolved (collapse or release path took over); skip — the other
    // watchers handle it.
    if (!sess || sess.state !== "soft") continue;
    out.push({
      soft_wait_id: w.id,
      checkout_session_id: w.checkout_session_id,
      variant_id: w.variant_id,
      product_id: product.id,
      product_name: product.name,
      product_slug: product.slug,
      variant_label: labels[i],
      queue_position: positionByMyId.get(w.id) ?? 1,
      session_expires_at: sess.expires_at,
      signup_detour_active: sess.signup_detour_at !== null,
    });
  }

  return ok(out);
}
