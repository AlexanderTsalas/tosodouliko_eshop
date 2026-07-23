"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveComboLabels } from "@/lib/variants/resolveComboLabel";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  session_id: z.string().uuid(),
});

export interface ContestedItem {
  cart_item_id: string;
  variant_id: string;
  product_name: string;
  variant_label: string | null;
  quantity: number;
}

/**
 * Returns the holder's cart items whose variant has at least one pending
 * `soft_waits` row behind the given session — i.e., the items being
 * actively contested. Used by the holder modal to list "drop these and
 * continue without them" candidates.
 *
 * Ownership check: caller must own the session.
 */
export async function getContestedItemsForSession(
  input: z.input<typeof Schema>
): Promise<Result<{ items: ContestedItem[] }>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<{ items: ContestedItem[] }>("Invalid input", "INVALID_INPUT");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<{ items: ContestedItem[] }>("Not authenticated", "UNAUTHENTICATED");

  const admin = createAdminClient();
  const { data: custRow } = await admin
    .from("customers")
    .select("id")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();
  const customerId = (custRow as { id: string } | null)?.id ?? null;
  if (!customerId) return fail<{ items: ContestedItem[] }>("Missing customer profile", "NO_CUSTOMER");

  const { data: sessionRow } = await admin
    .from("cart_checkout_sessions")
    .select("id, customer_id, cart_id, state")
    .eq("id", parsed.data.session_id)
    .maybeSingle();
  const session = sessionRow as {
    id: string;
    customer_id: string;
    cart_id: string | null;
    state: string;
  } | null;
  if (!session || session.customer_id !== customerId) {
    return fail<{ items: ContestedItem[] }>("Session not found", "NOT_FOUND");
  }
  if (!session.cart_id) return ok({ items: [] });

  // Distinct variant ids that have a pending soft_wait behind this session.
  const { data: contested } = await admin
    .from("soft_waits")
    .select("variant_id")
    .eq("checkout_session_id", parsed.data.session_id)
    .is("promoted_at", null);
  const contestedVariantIds = Array.from(
    new Set(
      ((contested ?? []) as Array<{ variant_id: string }>).map((r) => r.variant_id)
    )
  );
  if (contestedVariantIds.length === 0) return ok({ items: [] });

  // Pull the holder's cart_items + parent product info for those variants.
  const { data: items } = await admin
    .from("cart_items")
    .select(
      "id, variant_id, quantity, product_variants(attribute_combo, products(name))"
    )
    .eq("cart_id", session.cart_id)
    .in("variant_id", contestedVariantIds);

  type Row = {
    id: string;
    variant_id: string;
    quantity: number;
    product_variants:
      | {
          attribute_combo: Record<string, string> | null;
          products: { name: string } | { name: string }[] | null;
        }
      | {
          attribute_combo: Record<string, string> | null;
          products: { name: string } | { name: string }[] | null;
        }[]
      | null;
  };
  const rows = (items ?? []) as Row[];

  // Batch-resolve combo labels.
  const combos = rows.map((r) => {
    const variant = Array.isArray(r.product_variants)
      ? r.product_variants[0]
      : r.product_variants;
    return variant?.attribute_combo ?? null;
  });
  const labels = await resolveComboLabels(admin, combos);

  const result: ContestedItem[] = rows.map((r, i) => {
    const variant = Array.isArray(r.product_variants)
      ? r.product_variants[0]
      : r.product_variants;
    const product = variant?.products
      ? Array.isArray(variant.products)
        ? variant.products[0]
        : variant.products
      : null;
    return {
      cart_item_id: r.id,
      variant_id: r.variant_id,
      product_name: product?.name ?? "(unknown)",
      variant_label: labels[i],
      quantity: r.quantity,
    };
  });

  return ok({ items: result });
}
