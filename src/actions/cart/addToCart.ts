"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type Result } from "@/types/result";
import { validateSubmittedCustomFields } from "@/lib/custom-fields/validateSubmittedValues";

const CustomFieldEntrySchema = z.object({
  field_id: z.string().uuid(),
  /** For per_unit fields. NULL for per-line fields. */
  unit_index: z.number().int().nonnegative().nullable().optional(),
  /** Customer-submitted value — any jsonb-compatible shape. Validated
   *  server-side against the field's data_type + validation rules. */
  value: z.unknown(),
});

const AddToCartSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  quantity: z.number().int().positive(),
  /** Custom field values from the storefront form. The
   *  server re-validates each against the resolver-applicable field
   *  set + the field's validation rules; it NEVER trusts the
   *  client-supplied contributed_price. */
  customFieldValues: z.array(CustomFieldEntrySchema).optional(),
});

/**
 * Adds an item to the current user's active cart.
 *
 * Contract:
 * - unit_price MUST be fetched from product_variants.price (or products.base_price);
 *   never accepted from client input.
 * - Validates quantity > 0 (also enforced by DB CHECK).
 * - Custom field values:
 *   - Server-side validates each against the field's data_type +
 *     validation jsonb
 *   - Re-computes contributed_price from the FIELD's current modifier
 *     config (server-side) — never trusts the client
 *   - Locks the per-line modifier_total + per-field contributed_price
 *     into cart_items + cart_item_custom_fields at add time
 * - Upserts on (cart_id, variant_id) so duplicate adds increment
 *   quantity. The FIRST set of custom field values is preserved on
 *   subsequent adds (modifier_total stays as locked). To change field
 *   values, the customer removes the line and re-adds.
 */
export async function addToCart(
  input: z.infer<typeof AddToCartSchema>
): Promise<Result<{ cartItemId: string }>> {
  const parsed = AddToCartSchema.safeParse(input);
  if (!parsed.success) {
    return fail<{ cartItemId: string }>("Invalid input", "INVALID_INPUT");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<{ cartItemId: string }>("Not authenticated", "UNAUTHENTICATED");
  }
  const userId = authData.user.id;

  // Fetch unit_price + existing cart in parallel — both independent reads
  // that only need userId / productId, not each other's result.
  const priceQuery = parsed.data.variantId
    ? supabase
        .from("product_variants")
        .select("price, is_active")
        .eq("id", parsed.data.variantId)
        .maybeSingle()
    : supabase
        .from("products")
        .select("base_price, active")
        .eq("id", parsed.data.productId)
        .maybeSingle();

  const [priceResult, { data: existingCart }] = await Promise.all([
    priceQuery,
    supabase
      .from("carts")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle(),
  ]);

  let unitPrice: number;
  if (parsed.data.variantId) {
    const { data: v, error: vErr } = priceResult;
    if (vErr || !v || !(v as any).is_active) {
      return fail<{ cartItemId: string }>("Variant not found", "VARIANT_NOT_FOUND");
    }
    unitPrice = Number((v as any).price);
  } else {
    const { data: p, error: pErr } = priceResult;
    if (pErr || !p || !(p as any).active) {
      return fail<{ cartItemId: string }>("Product not found", "PRODUCT_NOT_FOUND");
    }
    unitPrice = Number((p as any).base_price);
  }

  // ─── Validate custom field values server-side ──────────
  // The validator re-runs the resolver to confirm applicability AND
  // re-prices each value's modifier from the server-side field config.
  let validated:
    | { values: Array<{
        field_id: string;
        unit_index: number | null;
        value: unknown;
        contributed_price: number;
      }>;
        modifier_total: number;
      }
    | null = null;
  if (
    parsed.data.customFieldValues &&
    parsed.data.customFieldValues.length > 0
  ) {
    const validation = await validateSubmittedCustomFields({
      product_id: parsed.data.productId,
      variant_id: parsed.data.variantId ?? null,
      base_price: unitPrice,
      submitted: parsed.data.customFieldValues.map((c) => ({
        field_id: c.field_id,
        unit_index: c.unit_index ?? null,
        value: c.value,
      })),
    });
    if (!validation.ok) {
      const f = validation.failure;
      switch (f.kind) {
        case "missing_required":
          return fail<{ cartItemId: string }>(
            "Συμπληρώστε όλα τα υποχρεωτικά πεδία.",
            "REQUIRED_FIELDS_MISSING"
          );
        case "invalid_value":
          return fail<{ cartItemId: string }>(
            f.reason,
            "INVALID_FIELD_VALUE"
          );
        case "unknown_field":
          return fail<{ cartItemId: string }>(
            "Άγνωστο πεδίο για αυτό το προϊόν.",
            "UNKNOWN_FIELD"
          );
      }
    }
    validated = validation;
  } else {
    // No custom field values supplied — but the field set might
    // include required fields. Run validator with empty submitted to
    // catch missing-required.
    const validation = await validateSubmittedCustomFields({
      product_id: parsed.data.productId,
      variant_id: parsed.data.variantId ?? null,
      base_price: unitPrice,
      submitted: [],
    });
    if (!validation.ok && validation.failure.kind === "missing_required") {
      return fail<{ cartItemId: string }>(
        "Συμπληρώστε όλα τα υποχρεωτικά πεδία.",
        "REQUIRED_FIELDS_MISSING"
      );
    }
    // Other failures shouldn't happen with empty submitted; safe to
    // proceed.
    if (validation.ok) {
      validated = validation;
    } else {
      validated = { values: [], modifier_total: 0 };
    }
  }

  let cartId: string;
  if (existingCart) {
    cartId = (existingCart as any).id;
  } else {
    const { data: newCart, error: createErr } = await supabase
      .from("carts")
      .insert({ user_id: userId, status: "active" })
      .select("id")
      .single();
    if (createErr || !newCart) {
      return fail<{ cartItemId: string }>("Failed to create cart", "CART_CREATE_FAILED");
    }
    cartId = (newCart as any).id;
  }

  // Upsert cart item — increment quantity on duplicate. The FIRST set
  // of custom field values is preserved on subsequent adds; we don't
  // overwrite modifier_total or insert new custom field rows on a
  // duplicate add. Customers who want a different config remove the
  // line first.
  const { data: existingItem } = await supabase
    .from("cart_items")
    .select("id, quantity")
    .eq("cart_id", cartId)
    .eq("product_id", parsed.data.productId)
    .eq("variant_id", parsed.data.variantId ?? null)
    .maybeSingle();

  if (existingItem) {
    const { error: updErr } = await supabase
      .from("cart_items")
      .update({ quantity: (existingItem as any).quantity + parsed.data.quantity })
      .eq("id", (existingItem as any).id);
    if (updErr) return fail<{ cartItemId: string }>(updErr.message, updErr.code);
    revalidatePath("/cart");
    return ok({ cartItemId: (existingItem as any).id });
  }

  const { data: inserted, error: insErr } = await supabase
    .from("cart_items")
    .insert({
      cart_id: cartId,
      product_id: parsed.data.productId,
      variant_id: parsed.data.variantId ?? null,
      quantity: parsed.data.quantity,
      unit_price: unitPrice,
      modifier_total: validated?.modifier_total ?? 0,
    })
    .select("id")
    .single();

  if (insErr || !inserted) {
    return fail<{ cartItemId: string }>(insErr?.message ?? "Insert failed", insErr?.code);
  }

  const cartItemId = (inserted as any).id as string;

  // Persist the validated custom field rows. Use the admin client so
  // we bypass RLS for this insertion — the rows are owned by the user
  // via the cart they reference, but we just inserted the line so the
  // ownership check would race with replication.
  if (validated && validated.values.length > 0) {
    const admin = createAdminClient();
    const rows = validated.values.map((v) => ({
      cart_item_id: cartItemId,
      field_id: v.field_id,
      unit_index: v.unit_index,
      value: v.value as object | string | number | boolean | null,
      contributed_price: v.contributed_price,
    }));
    const { error: cfErr } = await admin
      .from("cart_item_custom_fields")
      .insert(rows);
    if (cfErr) {
      // Best-effort rollback so the cart doesn't end up with a line
      // claiming a modifier_total it can't substantiate.
      await admin.from("cart_items").delete().eq("id", cartItemId);
      return fail<{ cartItemId: string }>(
        "Failed to persist custom field values: " + cfErr.message,
        cfErr.code
      );
    }
  }

  revalidatePath("/cart");
  return ok({ cartItemId });
}
