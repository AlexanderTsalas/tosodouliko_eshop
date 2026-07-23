"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { addToCart } from "./addToCart";
import { fail, ok, type Result } from "@/types/result";

const CustomFieldEntrySchema = z.object({
  field_id: z.string().uuid(),
  unit_index: z.number().int().nonnegative().nullable().optional(),
  value: z.unknown(),
});

const Schema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid(),
  quantity: z.number().int().positive().default(1),
  /** Forwarded to addToCart for server-side validation + persistence
   *  (Phase 8g). */
  customFieldValues: z.array(CustomFieldEntrySchema).optional(),
});

export interface AddContestedItem {
  product_id: string;
  variant_id: string;
  product_name: string;
  variant_label: string | null;
  requested_quantity: number;
  available_now: number;
}

export type AddToCartResult =
  | { kind: "ok" }
  | { kind: "contention"; contested: AddContestedItem[] };

/**
 * Wraps `addToCart` with a soft-contention pre-check. Before adding the
 * variant to the user's cart, queries `effective_available_for` to see if
 * the requested quantity is actually available. If not, returns a
 * structured "contention" payload the client uses to open the contention
 * modal — no item is added to the cart in that case.
 *
 * The pre-check has its own race window (between the check and the cart
 * insert), but the authoritative race protection lives downstream at
 * `hold_soft` (cart "Ολοκλήρωση παραγγελίας" click) and `reserve_inventory`
 * (final submit). This pre-check is for UX — telling the customer about
 * obvious contention before they've added items they won't be able to buy.
 */
export async function addToCartWithContentionCheck(
  input: z.infer<typeof Schema>
): Promise<Result<AddToCartResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<AddToCartResult>("Invalid input", "INVALID_INPUT");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<AddToCartResult>("Συνδεθείτε για να συνεχίσετε.", "UNAUTHENTICATED");
  }

  // Pre-check effective availability via the SQL function.
  const admin = createAdminClient();
  const { data: availData } = await admin.rpc("effective_available_for" as never, {
    p_variant_id: parsed.data.variantId,
    p_viewer_id: null,
  } as never);
  const availableNow = Number(availData ?? 0);

  if (availableNow < parsed.data.quantity) {
    // Build the contention payload — fetch product + variant details so the
    // modal can render the item by name.
    const { data: row } = await admin
      .from("product_variants")
      .select("id, attribute_combo, products(name)")
      .eq("id", parsed.data.variantId)
      .maybeSingle();
    const variantRow = row as
      | {
          id: string;
          attribute_combo: Record<string, string> | null;
          products: { name: string } | { name: string }[] | null;
        }
      | null;
    const product = Array.isArray(variantRow?.products)
      ? variantRow?.products[0]
      : variantRow?.products;
    let variantLabel: string | null = null;
    if (variantRow?.attribute_combo) {
      const ids = Object.values(variantRow.attribute_combo);
      if (ids.length > 0) {
        const { data: vRows } = await admin
          .from("attribute_values")
          .select("id, value")
          .in("id", ids);
        const byId = new Map(
          ((vRows ?? []) as Array<{ id: string; value: string }>).map((r) => [r.id, r.value])
        );
        const labels = ids.map((id) => byId.get(id)).filter(Boolean) as string[];
        variantLabel = labels.length > 0 ? labels.join(" · ") : null;
      }
    }

    return ok({
      kind: "contention",
      contested: [
        {
          product_id: parsed.data.productId,
          variant_id: parsed.data.variantId,
          product_name: product?.name ?? "(unknown)",
          variant_label: variantLabel,
          requested_quantity: parsed.data.quantity,
          available_now: availableNow,
        },
      ],
    });
  }

  // Forward to the normal addToCart. Inventory is unencumbered for this
  // variant right now — the customer's add doesn't engage any hold (holds
  // engage at "Ολοκλήρωση παραγγελίας"). The custom field values flow
  // through so addToCart can validate + persist them.
  const r = await addToCart({
    productId: parsed.data.productId,
    variantId: parsed.data.variantId,
    quantity: parsed.data.quantity,
    customFieldValues: parsed.data.customFieldValues,
  });
  if (!r.success) {
    return fail<AddToCartResult>(r.error, r.code);
  }
  return ok({ kind: "ok" });
}
