"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveComboLabel } from "@/lib/variants/resolveComboLabel";
import { fail, ok, type Result } from "@/types/result";

export interface ActivePromotion {
  priority_hold_id: string;
  variant_id: string;
  product_name: string;
  variant_label: string | null;
  product_slug: string;
  quantity: number;
  /** ISO timestamp. */
  expires_at: string;
  /** True iff at least one FIFO waiter still pending in the same bucket. */
  has_next_waiter: boolean;
}

/**
 * For the calling customer, returns the active soft_wait_promotion
 * priority_hold (if any). Drives the global PromotionModal — when a hold
 * is granted in their name, this is the payload the modal renders.
 *
 * Returns null when the customer has no active soft_wait_promotion hold.
 * If they have multiple (rare — one per variant they were waiting on),
 * returns the most recently granted.
 */
export async function getActivePromotion(): Promise<
  Result<ActivePromotion | null>
> {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return ok(null);

  const admin = createAdminClient();
  const { data: custRow } = await admin
    .from("customers")
    .select("id")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  const customerId = (custRow as { id: string } | null)?.id ?? null;
  if (!customerId) return ok(null);

  const { data: holdRow } = await admin
    .from("priority_holds")
    .select(
      "id, variant_id, quantity, expires_at, origin_soft_wait_id, product_variants(attribute_combo, products(name, slug))"
    )
    .eq("customer_id", customerId)
    .eq("source", "soft_wait_promotion")
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("granted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  type HoldRow = {
    id: string;
    variant_id: string;
    quantity: number;
    expires_at: string;
    origin_soft_wait_id: string | null;
    product_variants:
      | {
          attribute_combo: Record<string, string> | null;
          products: { name: string; slug: string } | { name: string; slug: string }[] | null;
        }
      | {
          attribute_combo: Record<string, string> | null;
          products: { name: string; slug: string } | { name: string; slug: string }[] | null;
        }[]
      | null;
  };
  const hold = holdRow as HoldRow | null;
  if (!hold) return ok(null);

  const variantData = Array.isArray(hold.product_variants)
    ? hold.product_variants[0]
    : hold.product_variants;
  const product = variantData?.products
    ? Array.isArray(variantData.products)
      ? variantData.products[0]
      : variantData.products
    : null;
  const variantLabel = await resolveComboLabel(admin, variantData?.attribute_combo ?? null);

  // "Has next waiter?" — look up the origin soft_wait, then find the next
  // pending row in the same (session, variant) bucket.
  let hasNext = false;
  if (hold.origin_soft_wait_id) {
    const { data: origin } = await admin
      .from("soft_waits")
      .select("checkout_session_id, created_at")
      .eq("id", hold.origin_soft_wait_id)
      .maybeSingle();
    const o = origin as { checkout_session_id: string; created_at: string } | null;
    if (o) {
      const { count } = await admin
        .from("soft_waits")
        .select("id", { count: "exact", head: true })
        .eq("checkout_session_id", o.checkout_session_id)
        .eq("variant_id", hold.variant_id)
        .is("promoted_at", null)
        .gt("created_at", o.created_at);
      hasNext = (count ?? 0) > 0;
    }
  }

  return ok({
    priority_hold_id: hold.id,
    variant_id: hold.variant_id,
    product_name: product?.name ?? "(unknown)",
    variant_label: variantLabel,
    product_slug: product?.slug ?? "",
    quantity: hold.quantity,
    expires_at: hold.expires_at,
    has_next_waiter: hasNext,
  });
}
