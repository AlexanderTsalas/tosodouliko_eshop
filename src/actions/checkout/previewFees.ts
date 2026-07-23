"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveFees } from "@/lib/fees/resolve";
import { listActiveCarriers } from "@/lib/courier/listActiveCarriers";
import { getCapabilities } from "@/lib/courier/getCapabilities";
import { fail, ok, type Result } from "@/types/result";
import type { FeeBreakdownEntry } from "@/types/fee";

/**
 * Read-only fee preview for the checkout UI. Mirrors placeOrder's resolveFees
 * call shape but commits nothing — exists so the customer sees the live
 * shipping / COD-handling / custom-fee amounts as they change delivery
 * method, carrier, payment method, or zipcode.
 *
 * Reads the user's active cart server-side (NOT trusting client-passed
 * lines) so the preview matches what placeOrder will compute. Returns
 * empty fees when there's no cart / no items / not authenticated — the
 * caller treats it as "nothing to show yet" rather than an error.
 */
const Schema = z.object({
  payment_method: z.enum(["stripe", "cod", "cash_on_pickup", "bank_transfer"]),
  delivery_method: z.enum([
    "home_delivery",
    "store_pickup",
    "delivery_station_pickup",
    "carrier_pickup",
  ]),
  carrier: z
    .enum(["acs", "elta", "box_now", "speedex", "geniki", "other"])
    .nullable()
    .optional(),
  recipient_zipcode: z.string().optional(),
  recipient_country: z.string().optional(),
  station_destination: z.string().nullable().optional(),
});

/**
 * Richer preview response than the raw FeeResolveResult. Includes the
 * inaccessibility flag and carrier display name so the checkout UI can
 * surface a "remote area" banner when applicable — driven by the
 * carrier's `surface_inaccessibility` capability.
 *
 * is_inaccessible is true only when:
 *   - the order has a carrier selected
 *   - the recipient_zipcode is in the carrier's remote-area list
 *   - the carrier has the `surface_inaccessibility` capability enabled
 *     (off → we suppress the banner even when the cache says remote, so
 *     a merchant who doesn't want to surface the warning can hide it)
 */
export interface FeePreviewResult {
  fees_total: number;
  fees_breakdown: FeeBreakdownEntry[];
  is_inaccessible: boolean;
  carrier_display_name: string | null;
}

const EMPTY: FeePreviewResult = {
  fees_total: 0,
  fees_breakdown: [],
  is_inaccessible: false,
  carrier_display_name: null,
};

export async function previewFees(
  input: z.input<typeof Schema>
): Promise<Result<FeePreviewResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<FeePreviewResult>("Invalid input", "INVALID_INPUT");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return ok(EMPTY);
  const userId = authData.user.id;
  const admin = createAdminClient();

  const { data: cartRow } = await admin
    .from("carts")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  const cart = cartRow as { id: string } | null;
  if (!cart) return ok(EMPTY);

  const { data: itemRows } = await admin
    .from("cart_items")
    .select(
      "product_id, variant_id, quantity, product_variants(price, weight_kg)"
    )
    .eq("cart_id", cart.id);

  type ItemRow = {
    product_id: string;
    variant_id: string | null;
    quantity: number;
    product_variants:
      | { price: number | string; weight_kg: number | string | null }
      | { price: number | string; weight_kg: number | string | null }[]
      | null;
  };
  const items = ((itemRows ?? []) as unknown as ItemRow[]).filter((r) => r.quantity > 0);
  if (items.length === 0) return ok(EMPTY);

  let subtotal = 0;
  let totalWeightKg = 0;
  let itemQty = 0;
  for (const r of items) {
    const v = Array.isArray(r.product_variants) ? r.product_variants[0] : r.product_variants;
    if (!v) continue;
    const lineTotal = Math.round(Number(v.price) * r.quantity * 100) / 100;
    subtotal = Math.round((subtotal + lineTotal) * 100) / 100;
    totalWeightKg += (Number(v.weight_kg ?? 0) || 0) * r.quantity;
    itemQty += r.quantity;
  }

  const productIds = Array.from(new Set(items.map((r) => r.product_id)));
  const variantIds = Array.from(
    new Set(items.map((r) => r.variant_id).filter((id): id is string => Boolean(id)))
  );
  const { data: pcRows } = await admin
    .from("product_categories")
    .select("category_id")
    .in("product_id", productIds);
  const categoryIds = Array.from(
    new Set(((pcRows ?? []) as Array<{ category_id: string }>).map((r) => r.category_id))
  );

  // Resolve carrier with active-carrier check. If the customer selected a
  // carrier that's no longer active (e.g., admin deactivated it after page
  // load), treat as null so resolveFees falls back to custom rules without
  // calling the API for an invalid carrier.
  const requestedCarrier =
    parsed.data.delivery_method === "store_pickup"
      ? null
      : (parsed.data.carrier ?? null);
  const activeCarriers = await listActiveCarriers();
  const resolvedCarrier =
    requestedCarrier && activeCarriers.some((c) => c.slug === requestedCarrier)
      ? requestedCarrier
      : null;

  const result = await resolveFees({
    payment_method: parsed.data.payment_method,
    delivery_method: parsed.data.delivery_method,
    carrier: resolvedCarrier,
    subtotal,
    // Matches placeOrder.ts — for non-COD orders the cod_amount is unused
    // by the resolver (the cod_handling category's applies_when filter
    // doesn't fire), so passing subtotal is harmless and simpler.
    cod_amount: subtotal,
    product_ids: productIds,
    variant_ids: variantIds,
    category_ids: categoryIds,
    recipient_zipcode: parsed.data.recipient_zipcode,
    recipient_country: parsed.data.recipient_country,
    weight_kg: totalWeightKg,
    item_quantity: itemQty,
    station_destination: parsed.data.station_destination ?? null,
  });

  // Phase 5 — derive inaccessibility for the checkout banner. Read the
  // postcode cache directly rather than re-calling fetchCarrierQuote (which
  // would re-run priceCalculate). The cache is populated as a side effect
  // of the resolveFees call above when address_validation is on, so by
  // the time we get here the row almost certainly exists for the relevant
  // (carrier, country, zipcode). When it doesn't (cold cache, custom-rules
  // only path), we conservatively report false rather than triggering an
  // extra API call.
  let isInaccessible = false;
  let carrierDisplayName: string | null = null;
  if (resolvedCarrier && parsed.data.recipient_zipcode) {
    const country = (parsed.data.recipient_country ?? "GR").toUpperCase();
    const capabilities = await getCapabilities(resolvedCarrier);
    if (capabilities.has("surface_inaccessibility")) {
      const { data: cacheRow } = await admin
        .from("couriers_postcode_cache")
        .select("is_inaccessible")
        .eq("carrier", resolvedCarrier)
        .eq("country", country)
        .eq("zipcode", parsed.data.recipient_zipcode.trim())
        .maybeSingle();
      isInaccessible = Boolean(
        (cacheRow as { is_inaccessible: boolean } | null)?.is_inaccessible
      );
    }
    const activeRow = activeCarriers.find((c) => c.slug === resolvedCarrier);
    carrierDisplayName = activeRow?.display_name ?? null;
  }

  return ok({
    fees_total: result.fees_total,
    fees_breakdown: result.fees_breakdown,
    is_inaccessible: isInaccessible,
    carrier_display_name: carrierDisplayName,
  });
}
