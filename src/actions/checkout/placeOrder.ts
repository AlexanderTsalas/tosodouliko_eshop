"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit-log";
import { sendEmail } from "@/lib/email";
import { resolveFees } from "@/lib/fees/resolve";
import {
  reserveAllOrFail,
  releaseAll,
  type ReservationLine,
} from "@/lib/inventory/reserveAllOrFail";
import {
  promoteAllOrFail,
  releaseSoftAll,
} from "@/lib/inventory/holdSoftAllOrFail";
import { resolveComboLabels } from "@/lib/variants/resolveComboLabel";
import { isCompatible } from "@/config/checkout-compatibility";
import { listActiveCarriers } from "@/lib/courier/listActiveCarriers";
import { findCustomerMatches } from "@/lib/customers/matchSignals";
import {
  applyOffersAtPlaceOrder,
  recordOfferApplications,
} from "@/lib/offers";
import { fail, ok, type Result } from "@/types/result";

/**
 * BoxNow contractual COD cap. Their API rejects parcels with
 * COD amount above this threshold; enforced at checkout placement so the
 * customer gets a clear Greek error instead of a provider 4xx surfaced
 * after the order is committed.
 */
const BOX_NOW_COD_CAP_EUR = 5000;

const AddressSchema = z
  .object({
    first_name: z.string().max(100).optional(),
    last_name: z.string().max(100).optional(),
    street: z.string().max(300).optional(),
    address_line2: z.string().max(300).optional(),
    city: z.string().max(120).optional(),
    state: z.string().max(120).optional(),
    postal_code: z.string().max(20).optional(),
    country_code: z.string().length(2).optional(),
    phone: z.string().max(40).optional(),
    notes: z.string().max(500).optional(),
  })
  .partial();

const BuyerSchema = z
  .object({
    first_name: z.string().max(100).optional(),
    last_name: z.string().max(100).optional(),
    email: z.string().email().max(200).optional(),
    phone: z.string().max(40).optional(),
  })
  .partial();

const Schema = z.object({
  /** All four payment_methods supported on the customer side. */
  payment_method: z.enum(["stripe", "cod", "cash_on_pickup", "bank_transfer"]),
  delivery_method: z.enum([
    "home_delivery",
    "store_pickup",
    "delivery_station_pickup",
    "carrier_pickup",
  ]),
  carrier: z.enum(["acs", "elta", "box_now", "speedex", "geniki", "other"]).nullable().optional(),
  /**
   * Buyer block — who is *placing* the order. Persisted onto the customers
   * row so the offline-customer identity gets populated for returning-guest
   * matching and eventual signup linkage. Distinct from the recipient block
   * inside shipping_address (gift-order pattern: A buys, B receives).
   */
  buyer: BuyerSchema.optional(),
  shipping_address: AddressSchema.optional(),
  billing_address: AddressSchema.optional(),
  /** Optional saved-address ids to use instead of inline forms. */
  shipping_address_id: z.string().uuid().nullable().optional(),
  billing_address_id: z.string().uuid().nullable().optional(),
  customer_notes: z.string().max(2000).optional(),
  /**
   * Phase 2 of inventory contention. The id of the cart_checkout_sessions row
   * created when the customer clicked "Ολοκλήρωση παραγγελίας" from the cart.
   * Holds inventory in quantity_soft_held; this action promotes those holds
   * to quantity_reserved.
   *
   * Optional for backward compatibility — when absent, the action falls back
   * to the Phase 1 path (reserveAllOrFail directly from cart_items). Phase 2's
   * normal flow always supplies it.
   */
  checkout_session_id: z.string().uuid().optional(),
  /**
   * Phase 7 — pickup point selection from LocationPicker. Required when
   * delivery_method is delivery_station_pickup or carrier_pickup AND the
   * carrier doesn't support defer_locker_selection. Validated below.
   */
  pickup: z
    .object({
      carrier: z.string().max(50),
      station_id: z.string().max(100),
      branch_id: z.number().int(),
      type: z.enum(["locker", "branch"]),
    })
    .optional(),
  /**
   * Custom relabel layer (admin-defined). When set, the order is tagged
   * with this slug for receipt rendering. The delivery_method field still
   * holds the base method for fulfillment / reporting. Validated against
   * custom_delivery_methods (must exist, must be active, must match the
   * supplied base method, and if scoped to a carrier must match it).
   */
  custom_delivery_method_slug: z.string().max(80).optional(),
});

interface PlaceOrderResult {
  order_id: string;
  order_number: string;
  /**
   * For stripe: redirect to /checkout/payment/[order_id] to confirm payment.
   * For cod / cash_on_pickup / bank_transfer: redirect to /checkout/success/[order_id].
   */
  next_step: "payment" | "success";
}

/**
 * Customer-facing order placement. Differs from the admin createOrder action:
 *
 *   - source is always 'eshop'
 *   - payment_method may be 'stripe' (admin form excludes it)
 *   - line items + prices come from the caller's cart, never from input
 *   - permission gate is "must be the authenticated user" (no admin role)
 *   - cart is marked 'converted' on success so the same cart can't be
 *     checked out twice
 *
 * Inventory rules (per design):
 *   - Stripe → no reservation at placement. The webhook calls fulfillOrder()
 *     which decrement_inventory. Race risk window is the time between place
 *     and confirm; acceptable for early stage.
 *   - COD / cash_on_pickup / bank_transfer → reserve_inventory immediately.
 *     The order moves through the standard reservation lifecycle.
 */
export async function placeOrder(
  input: z.input<typeof Schema>
): Promise<Result<PlaceOrderResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return fail<PlaceOrderResult>(
      "Invalid input: " + parsed.error.issues[0].message,
      "INVALID_INPUT"
    );
  }
  // Structural compatibility gate — covers all (delivery × payment × carrier)
  // combinations, not just store_pickup+carrier. The same matrix drives the
  // client-side UI disabling in CheckoutForm, so a curl-bypass that lands
  // here will hit the same rules. The active-carrier set is fetched fresh
  // so that an admin who deactivated a carrier between page load and submit
  // rejects the stale selection rather than letting it sneak through.
  // See src/config/checkout-compatibility.ts.
  const activeCarriers = await listActiveCarriers();
  const compat = isCompatible(
    parsed.data.delivery_method,
    parsed.data.payment_method,
    parsed.data.carrier ?? null,
    activeCarriers
  );
  if (!compat.ok) {
    return fail<PlaceOrderResult>(compat.reason, "INVALID_INPUT");
  }

  // Phase 7 — pickup selection validation. Locker/branch delivery methods
  // require a chosen pickup point; home/store deliveries must NOT provide
  // one. The selected pickup_type must match the delivery_method to
  // prevent a customer from picking a locker but submitting under
  // carrier_pickup (or vice versa).
  const requiresPickup =
    parsed.data.delivery_method === "delivery_station_pickup" ||
    parsed.data.delivery_method === "carrier_pickup";
  if (requiresPickup && !parsed.data.pickup) {
    return fail<PlaceOrderResult>(
      "Επιλέξτε σημείο παραλαβής.",
      "PICKUP_REQUIRED"
    );
  }
  if (!requiresPickup && parsed.data.pickup) {
    return fail<PlaceOrderResult>(
      "Σημείο παραλαβής δεν εφαρμόζεται σε αυτόν τον τρόπο παράδοσης.",
      "PICKUP_NOT_APPLICABLE"
    );
  }
  if (parsed.data.pickup) {
    const expectedType: "locker" | "branch" =
      parsed.data.delivery_method === "delivery_station_pickup" ? "locker" : "branch";
    if (parsed.data.pickup.type !== expectedType) {
      return fail<PlaceOrderResult>(
        "Ο τύπος σημείου παραλαβής δεν ταιριάζει με τον τρόπο παράδοσης.",
        "PICKUP_TYPE_MISMATCH"
      );
    }
    // Pickup carrier must be in the active set — defends against a UI bypass
    // that submits a carrier the admin has since deactivated.
    if (!activeCarriers.some((c) => c.slug === parsed.data.pickup!.carrier)) {
      return fail<PlaceOrderResult>(
        "Η επιλεγμένη μεταφορική σημείου παραλαβής δεν είναι διαθέσιμη.",
        "PICKUP_CARRIER_INACTIVE"
      );
    }
  }

  // Custom delivery method validation. Defends against a UI bypass that
  // sends an inactive / non-existent slug, or a slug whose base_method or
  // carrier_slug doesn't match what's being submitted on the rest of the
  // payload (which would cause the receipt + fulfillment to disagree).
  if (parsed.data.custom_delivery_method_slug) {
    const admin = createAdminClient();
    const { data: cmRow } = await admin
      .from("custom_delivery_methods")
      .select("slug, base_method, carrier_slug, is_active")
      .eq("slug", parsed.data.custom_delivery_method_slug)
      .maybeSingle();
    const cm = cmRow as
      | {
          slug: string;
          base_method: string;
          carrier_slug: string | null;
          is_active: boolean;
        }
      | null;
    if (!cm || !cm.is_active) {
      return fail<PlaceOrderResult>(
        "Ο επιλεγμένος τρόπος παράδοσης δεν είναι διαθέσιμος.",
        "CUSTOM_METHOD_INACTIVE"
      );
    }
    if (cm.base_method !== parsed.data.delivery_method) {
      return fail<PlaceOrderResult>(
        "Ο επιλεγμένος τρόπος παράδοσης δεν ταιριάζει με την υποδοκείμενη μέθοδο.",
        "CUSTOM_METHOD_BASE_MISMATCH"
      );
    }
    if (cm.carrier_slug && cm.carrier_slug !== (parsed.data.carrier ?? null)) {
      return fail<PlaceOrderResult>(
        "Ο επιλεγμένος τρόπος παράδοσης απαιτεί συγκεκριμένη μεταφορική.",
        "CUSTOM_METHOD_CARRIER_MISMATCH"
      );
    }
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return fail<PlaceOrderResult>("Συνδεθείτε για να ολοκληρώσετε την παραγγελία.", "UNAUTHENTICATED");
  }
  const userId = authData.user.id;

  const admin = createAdminClient();

  // Resolve the caller's customer row (auto-created on signup via trigger).
  const { data: custRow } = await admin
    .from("customers")
    .select("id, email, phone, first_name, last_name, preferred_currency")
    .eq("auth_user_id", userId)
    .maybeSingle();
  let customer = custRow as {
    id: string;
    email: string | null;
    phone: string | null;
    first_name: string | null;
    last_name: string | null;
    preferred_currency: string;
  } | null;
  if (!customer) {
    return fail<PlaceOrderResult>(
      "Λείπει το προφίλ πελάτη. Αποσυνδεθείτε και ξανασυνδεθείτε.",
      "NO_CUSTOMER"
    );
  }

  // Persist the buyer block onto the customer row. This is the moment the
  // offline-customer identity gets populated from form data — enables
  // returning-guest matching on next visit, and seeds the contact fields a
  // future signup will inherit. Only update fields that actually came in
  // (don't NULL-out existing values).
  if (parsed.data.buyer) {
    const b = parsed.data.buyer;
    const patch: Record<string, unknown> = {};
    if (b.first_name && b.first_name.trim()) patch.first_name = b.first_name.trim();
    if (b.last_name && b.last_name.trim()) patch.last_name = b.last_name.trim();
    if (b.email && b.email.trim()) patch.email = b.email.trim();
    if (b.phone && b.phone.trim()) patch.phone = b.phone.trim();
    // ─── Customer patch + offline-customer dedup ──────────────────────
    // The customer UPDATE and findCustomerMatches (offline-dedup lookup)
    // are run in PARALLEL — neither depends on the other's result. The
    // UPDATE returns the refreshed customer row; the matches call
    // queries the customers table for HIGH-scoring offline records.
    // Follow-up Phase 3b — saves one round-trip on every authenticated
    // checkout.
    //
    // Auto-merge policy (HIGH confidence only):
    //   1. Move all orders from the offline customer → current customer
    //   2. Delete the offline customer (the canonical record is now
    //      the auth-linked one)
    //   3. Audit-log the merge for traceability
    //
    // MEDIUM matches do NOT auto-merge — the admin will see them via
    // the customer page's "Πιθανά διπλότυπα" surface (planned).
    const buyerHasSignal = Boolean(
      (b.email && b.email.trim()) || (b.phone && b.phone.trim())
    );
    const shouldPatch = Object.keys(patch).length > 0;
    if (shouldPatch) {
      patch.updated_at = new Date().toISOString();
    }

    const [patchRes, matchesRes] = await Promise.all([
      shouldPatch
        ? admin
            .from("customers")
            .update(patch)
            .eq("id", customer.id)
            .select("id, email, phone, first_name, last_name, preferred_currency")
            .single()
        : Promise.resolve({ data: null, error: null }),
      buyerHasSignal
        ? findCustomerMatches(
            admin,
            {
              email: b.email,
              phone: b.phone,
              first_name: b.first_name,
              last_name: b.last_name,
            },
            { onlyOffline: true }
          )
        : Promise.resolve([]),
    ]);

    if (patchRes.data) {
      customer = patchRes.data as typeof customer;
    }

    if (buyerHasSignal) {
      const matches = matchesRes;
      const highMatch = matches.find(
        (m) => m.confidence === "high" && m.customer.id !== customer!.id
      );
      if (highMatch) {
        const offlineId = highMatch.customer.id;
        const currentId = customer.id;
        // Race-safe merge via the dedicated RPC. The function acquires
        // a transaction-scoped advisory lock keyed on (source, target),
        // re-checks that source still exists (loser of a parallel-tab
        // race exits with outcome='already_merged'), and atomically
        // moves orders + addresses + deletes the source. Replaces the
        // previous best-effort JS sequence which could leak partial
        // state if the DELETE failed unexpectedly.
        const { data: mergeResult, error: mergeErr } = await admin.rpc(
          "merge_offline_customer",
          { p_source_id: offlineId, p_target_id: currentId }
        );
        if (!mergeErr && mergeResult) {
          const outcome = mergeResult as {
            outcome: "merged" | "already_merged";
            orders_moved: number;
            addresses_moved: number;
          };
          await logAuditEvent({
            actor_id: authData.user.id,
            actor_type: "user",
            action: "customer.auto_merged",
            resource_type: "customer",
            resource_id: currentId,
            metadata: {
              merged_from: offlineId,
              reasons: highMatch.reasons,
              score: highMatch.score,
              trigger: "placeOrder",
              outcome: outcome.outcome,
              orders_moved: outcome.orders_moved,
              addresses_moved: outcome.addresses_moved,
            },
          });
        }
        // mergeErr is intentionally swallowed — the order placement
        // must continue even if the dedup merge fails. Operators see
        // the dangling offline shell via the "Πιθανά διπλότυπα"
        // surface on the customer page; they can merge manually then.
      }
    }
  }

  // Load the active cart for this user.
  const { data: cartRow } = await admin
    .from("carts")
    .select("id, status")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  const cart = cartRow as { id: string; status: string } | null;
  if (!cart) {
    return fail<PlaceOrderResult>("Το καλάθι σας είναι άδειο.", "EMPTY_CART");
  }

  // Load cart items with the join we need for line snapshots. The
  // modifier_total column is per-unit and was locked at
  // add-to-cart; we pass it through to the order line totals so the
  // customer pays the right amount including custom-field add-ons.
  const { data: itemRows } = await admin
    .from("cart_items")
    .select(
      "id, product_id, variant_id, quantity, unit_price, modifier_total, " +
        "products(name), product_variants(sku, attribute_combo, price, weight_kg)"
    )
    .eq("cart_id", cart.id);

  type CartRow = {
    id: string;
    product_id: string;
    variant_id: string | null;
    quantity: number;
    unit_price: number | string;
    modifier_total: number | string;
    products: { name: string } | { name: string }[] | null;
    product_variants: {
      sku: string;
      attribute_combo: Record<string, string> | null;
      price: number | string;
      weight_kg: number | string | null;
    } | {
      sku: string;
      attribute_combo: Record<string, string> | null;
      price: number | string;
      weight_kg: number | string | null;
    }[] | null;
  };
  const items = ((itemRows ?? []) as unknown as CartRow[]).filter((r) => r.quantity > 0);
  if (items.length === 0) {
    return fail<PlaceOrderResult>("Το καλάθι σας είναι άδειο.", "EMPTY_CART");
  }

  // Build order lines from server-trusted variant prices (NOT cart.unit_price —
  // re-fetch in case a price changed since add-to-cart).
  type LinePayload = {
    product_id: string;
    variant_id: string | null;
    product_name: string;
    variant_label: string | null;
    sku: string | null;
    quantity: number;
    unit_price: number;
    /** Per-unit custom-field modifier, passed through from
     *  cart_items.modifier_total. Locked at add-to-cart time so the
     *  customer pays exactly what the storefront preview showed. */
    modifier_total: number;
    total: number;
    weight_kg: number;
  };
  const lines: LinePayload[] = [];
  let subtotal = 0;
  let totalWeightKg = 0;

  // Resolve combo labels + addresses + product categories in parallel —
  // all three are independent reads that only need items + customer.id.
  const combos = items.map((r) => {
    const variant = Array.isArray(r.product_variants) ? r.product_variants[0] : r.product_variants;
    return (variant?.attribute_combo as Record<string, string> | null | undefined) ?? null;
  });
  const productIds = Array.from(new Set(items.map((r) => r.product_id)));

  const [variantLabels, shippingLookup, billingLookup, { data: pcRows }] =
    await Promise.all([
      resolveComboLabels(admin, combos),
      parsed.data.shipping_address_id
        ? admin
            .from("addresses")
            .select("*")
            .eq("id", parsed.data.shipping_address_id)
            .eq("customer_id", customer.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      parsed.data.billing_address_id
        ? admin
            .from("addresses")
            .select("*")
            .eq("id", parsed.data.billing_address_id)
            .eq("customer_id", customer.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      productIds.length > 0
        ? admin
            .from("product_categories")
            .select("product_id, category_id")
            .in("product_id", productIds)
        : Promise.resolve({ data: [] as Array<{ category_id: string }> }),
    ]);

  // Validate addresses.
  let shippingAddressJson: Record<string, unknown> | null = parsed.data.shipping_address ?? null;
  let billingAddressJson: Record<string, unknown> | null = parsed.data.billing_address ?? null;
  if (parsed.data.shipping_address_id) {
    if (!shippingLookup.data) {
      return fail<PlaceOrderResult>("Άκυρη διεύθυνση αποστολής.", "BAD_ADDRESS");
    }
    shippingAddressJson = shippingLookup.data as Record<string, unknown>;
  }
  if (parsed.data.billing_address_id) {
    if (!billingLookup.data) {
      return fail<PlaceOrderResult>("Άκυρη διεύθυνση χρέωσης.", "BAD_ADDRESS");
    }
    billingAddressJson = billingLookup.data as Record<string, unknown>;
  }

  // Build order lines from the resolved data.
  for (let i = 0; i < items.length; i++) {
    const r = items[i];
    const product = Array.isArray(r.products) ? r.products[0] : r.products;
    const variant = Array.isArray(r.product_variants) ? r.product_variants[0] : r.product_variants;
    if (!product || !variant) {
      return fail<PlaceOrderResult>(
        "Ένα προϊόν του καλαθιού δεν είναι πλέον διαθέσιμο. Ανανεώστε το καλάθι σας.",
        "STALE_CART"
      );
    }
    const unitPrice = Number(variant.price);
    // Phase 8g: per-unit modifier was frozen at add-to-cart. We trust
    // it here rather than re-validating — the cart action already
    // re-computed against server-side field config when the customer
    // added the line.
    const modifierPerUnit = Number(r.modifier_total) || 0;
    const lineTotal =
      Math.round((unitPrice + modifierPerUnit) * r.quantity * 100) / 100;
    const weight = Number(variant.weight_kg ?? 0) || 0;
    lines.push({
      product_id: r.product_id,
      variant_id: r.variant_id,
      product_name: product.name,
      variant_label: variantLabels[i],
      sku: variant.sku,
      quantity: r.quantity,
      unit_price: unitPrice,
      modifier_total: modifierPerUnit,
      total: lineTotal,
      weight_kg: weight,
    });
    subtotal = Math.round((subtotal + lineTotal) * 100) / 100;
    totalWeightKg += weight * r.quantity;
  }

  // BoxNow COD cap. BoxNow's API rejects parcels with COD
  // amount above €5000; surface the constraint at checkout rather than
  // letting it bubble out as a cryptic provider error after the order is
  // already committed.
  if (
    parsed.data.carrier === "box_now" &&
    parsed.data.payment_method === "cod" &&
    subtotal > BOX_NOW_COD_CAP_EUR
  ) {
    return fail<PlaceOrderResult>(
      `Η αντικαταβολή μέσω BoxNow περιορίζεται σε €${BOX_NOW_COD_CAP_EUR}. Επιλέξτε άλλη μέθοδο πληρωμής ή μεταφορική.`,
      "BOX_NOW_COD_CAP_EXCEEDED"
    );
  }

  // Resolve fees (shipping, COD handling, any merchant-defined extras) via
  // the rules engine. Product categories were already fetched in the
  // Promise.all above (pcRows); derive categoryIds here.
  const variantIds = Array.from(
    new Set(lines.map((l) => l.variant_id).filter((id): id is string => Boolean(id)))
  );
  const categoryIds = Array.from(
    new Set(
      ((pcRows ?? []) as Array<{ product_id: string; category_id: string }>).map(
        (r) => r.category_id
      )
    )
  );

  const recipientZip = String(
    (shippingAddressJson as { postal_code?: string } | null)?.postal_code ?? ""
  ).trim();
  const recipientCountry =
    String((shippingAddressJson as { country_code?: string } | null)?.country_code ?? "GR")
      .toUpperCase() || "GR";

  const feeResult = await resolveFees({
    payment_method: parsed.data.payment_method,
    delivery_method: parsed.data.delivery_method,
    carrier:
      parsed.data.delivery_method === "store_pickup"
        ? null
        : (parsed.data.carrier ?? null),
    subtotal,
    // Approximation: COD amount = subtotal. A later phase refines this to
    // include fees + tax when needed (the total amount the recipient hands
    // over to the courier).
    cod_amount: subtotal,
    product_ids: productIds,
    variant_ids: variantIds,
    category_ids: categoryIds,
    recipient_zipcode: recipientZip || undefined,
    recipient_country: recipientCountry,
    weight_kg: totalWeightKg,
    item_quantity: lines.reduce((s, l) => s + l.quantity, 0),
  });

  // ─── Offers engine ─────────────────────────────────────
  // Apply any auto-apply offers + any codes the customer has entered
  // via the checkout session. The helper honors a checkout-intent
  // snapshot if one was captured + is still valid (TTL + subtotal
  // sanity); otherwise it does a fresh evaluation. Fee waivers are
  // also applied here — the fees_breakdown gets its `charged` zeroed
  // on waived rows while `api_quote` stays for accounting.
  const offerResult = await applyOffersAtPlaceOrder({
    admin,
    checkoutSessionId: parsed.data.checkout_session_id ?? null,
    customerId: customer.id,
    // Anonymous-auth users still have authData.user populated; the
    // is_anonymous flag on Supabase's User distinguishes them. Falsy
    // is_anonymous (undefined or false) → treat as authenticated.
    isAuthenticated: !(authData.user.is_anonymous ?? false),
    lines: lines
      .filter((l): l is typeof l & { variant_id: string } => l.variant_id !== null)
      .map((l) => ({
        variant_id: l.variant_id,
        product_id: l.product_id,
        category_ids: ((pcRows ?? []) as Array<{
          product_id: string;
          category_id: string;
        }>)
          .filter((r) => r.product_id === l.product_id)
          .map((r) => r.category_id),
        quantity: l.quantity,
        unit_price: l.unit_price,
      })),
    subtotal,
    itemCount: lines.reduce((s, l) => s + l.quantity, 0),
    feesBreakdown: feeResult.fees_breakdown,
  });

  const adjustedFeesBreakdown = offerResult.adjustedFeesBreakdown;
  const feesTotal = offerResult.adjustedFeesTotal;
  const discountAmount = offerResult.discountAmount;
  const appliedOffers = offerResult.applied;

  const shippingAmount =
    adjustedFeesBreakdown.find((e) => e.category_slug === "shipping")?.charged ?? 0;

  // Tax still placeholder — handled separately by upcoming phases.
  const taxAmount = 0;
  const total =
    Math.round(
      (subtotal + feesTotal + taxAmount - discountAmount) * 100
    ) / 100;

  // Insert the order. order_number is autogenerated by DB default.
  const customerName =
    [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim() || null;
  const orderPayload = {
    customer_id: customer.id,
    customer_name_at_order: customerName,
    customer_email_at_order: customer.email,
    customer_phone_at_order: customer.phone,
    payment_method: parsed.data.payment_method,
    delivery_method: parsed.data.delivery_method,
    carrier:
      parsed.data.delivery_method === "store_pickup" ? null : parsed.data.carrier ?? null,
    source: "eshop" as const,
    payment_status: "pending" as const,
    fulfillment_status: "pending" as const,
    created_by: null, // self-checkout
    currency: customer.preferred_currency,
    subtotal,
    discount_amount: discountAmount,
    // Keep shipping_amount populated for backward compat with any code that
    // hasn't migrated to reading fees_breakdown yet. Same number, two homes.
    shipping_amount: shippingAmount,
    tax_amount: taxAmount,
    fees_total: feesTotal,
    fees_breakdown: adjustedFeesBreakdown,
    total,
    shipping_address: shippingAddressJson,
    billing_address: billingAddressJson,
    notes: parsed.data.customer_notes ?? null,
    // Phase 7 — pickup selection from LocationPicker. All null for
    // home_delivery and store_pickup; populated for locker/branch.
    pickup_carrier: parsed.data.pickup?.carrier ?? null,
    pickup_station_id: parsed.data.pickup?.station_id ?? null,
    pickup_branch_id: parsed.data.pickup?.branch_id ?? null,
    pickup_type: parsed.data.pickup?.type ?? null,
    custom_delivery_method_slug:
      parsed.data.custom_delivery_method_slug ?? null,
  };

  // Reserve inventory for every line BEFORE the order is created. Two paths:
  //
  //   Phase 2 path (normal): customer arrived here via "Ολοκλήρωση παραγγελίας"
  //   which created a cart_checkout_sessions row with state='soft'. The items
  //   are already in quantity_soft_held; we promote them to quantity_reserved
  //   atomically via promote_soft_to_reserved.
  //
  //   Phase 1 fallback path: no checkout_session_id was supplied (or the
  //   session has expired/been released). We fall back to direct
  //   reserve_inventory which is also race-safe. This handles edge cases:
  //   pre-Phase-2 tabs still open, sessions expired by the reaper between
  //   form load and submit, etc.
  //
  // Either way, reservation failure means no order is created.
  const reservationLines: ReservationLine[] = lines
    .filter((l): l is typeof l & { variant_id: string } => Boolean(l.variant_id))
    .map((l) => ({ variant_id: l.variant_id, quantity: l.quantity }));

  // Validate the checkout session if one was supplied. Must exist, belong
  // to this customer, still be in 'soft' state, and not be expired.
  let activeSessionId: string | null = null;
  if (parsed.data.checkout_session_id) {
    const { data: sessionRow } = await admin
      .from("cart_checkout_sessions")
      .select("id, state, expires_at, customer_id, cart_id")
      .eq("id", parsed.data.checkout_session_id)
      .maybeSingle();
    const session = sessionRow as
      | {
          id: string;
          state: string;
          expires_at: string;
          customer_id: string;
          cart_id: string | null;
        }
      | null;
    if (
      session &&
      session.customer_id === customer.id &&
      session.state === "soft" &&
      new Date(session.expires_at).getTime() > Date.now()
    ) {
      activeSessionId = session.id;
    }
    // If the session is invalid/expired we just fall through to the Phase 1
    // path. The soft holds (if any) will be cleaned up by the reaper or by
    // a subsequent startCheckoutSession call.
  }

  if (activeSessionId) {
    const promoteResult = await promoteAllOrFail(reservationLines);
    if (!promoteResult.success) {
      // Promotion failed mid-loop. Whatever was promoted has already been
      // rolled back by promoteAllOrFail; whatever was still in soft_held
      // for this session needs releasing too.
      await releaseSoftAll(reservationLines);
      await admin
        .from("cart_checkout_sessions")
        .update({ state: "released", updated_at: new Date().toISOString() })
        .eq("id", activeSessionId);
      return fail<PlaceOrderResult>(
        promoteResult.code === "SOFT_HOLD_GONE"
          ? "Η συνεδρία πληρωμής έληξε. Επιστρέψτε στο καλάθι σας και δοκιμάστε ξανά."
          : "Λυπούμαστε, κάποιο προϊόν εξαντλήθηκε ενώ τοποθετούσατε την παραγγελία. Ανανεώστε το καλάθι σας και δοκιμάστε ξανά.",
        promoteResult.code
      );
    }
  } else {
    const reserveResult = await reserveAllOrFail(reservationLines);
    if (!reserveResult.success) {
      return fail<PlaceOrderResult>(
        reserveResult.code === "INSUFFICIENT_INVENTORY"
          ? "Λυπούμαστε, κάποιο προϊόν εξαντλήθηκε ενώ τοποθετούσατε την παραγγελία. Ανανεώστε το καλάθι σας και δοκιμάστε ξανά."
          : reserveResult.error,
        reserveResult.code
      );
    }
  }

  // Atomic commit of orders row + order_items lines.
  //
  // Previously these were two separate HTTP round-trips with
  // compensating JS delete on lines-failure — the compensation could
  // ALSO fail, leaving an orphan order row. commit_order_with_lines
  // does both in a single PG transaction: if any line insert fails
  // (FK violation, malformed combo, CHECK trip), the order insert
  // automatically rolls back too. No compensating delete needed.
  const linesForRpc = lines.map(({ weight_kg: _w, ...l }) => l);
  const { data: commitData, error: orderErr } = await admin.rpc(
    "commit_order_with_lines",
    {
      p_order: orderPayload as unknown as Record<string, unknown>,
      p_lines: linesForRpc as unknown as Record<string, unknown>[],
    }
  );
  if (orderErr || !commitData || commitData.length === 0) {
    // Whole transaction rolled back — no order, no lines. Release
    // the reservations we acquired above and unwind the soft session.
    await releaseAll(reservationLines);
    if (activeSessionId) {
      await admin
        .from("cart_checkout_sessions")
        .update({ state: "released", updated_at: new Date().toISOString() })
        .eq("id", activeSessionId);
    }
    return fail<PlaceOrderResult>(
      orderErr?.message ?? "Order commit failed",
      orderErr?.code
    );
  }
  const commitRow = commitData[0] as { order_id: string; order_number: string };
  const order = { id: commitRow.order_id, order_number: commitRow.order_number };

  // ─── Phase 8g: copy cart_item_custom_fields → order_item_custom_fields ─
  //
  // Best-effort: failure here doesn't roll back the order. The customer
  // has paid; the order line totals already include modifier_total
  // (frozen at add-to-cart). If the row copy fails, the merchant loses
  // the per-field metadata (gift message, engraving, etc.) — we log
  // and let fulfillment ops sort it out, rather than reverse the
  // payment over a metadata copy.
  try {
    const cartItemIds = items.map((r) => r.id);
    if (cartItemIds.length > 0) {
      const [cartFieldsRes, orderItemsRes] = await Promise.all([
        admin
          .from("cart_item_custom_fields")
          .select("cart_item_id, field_id, unit_index, value, contributed_price")
          .in("cart_item_id", cartItemIds),
        admin
          .from("order_items")
          .select("id, product_id, variant_id")
          .eq("order_id", order.id),
      ]);
      type CartFieldRow = {
        cart_item_id: string;
        field_id: string;
        unit_index: number | null;
        value: unknown;
        contributed_price: number | string;
      };
      const cartFields = (cartFieldsRes.data ?? []) as CartFieldRow[];
      type OrderItemRow = {
        id: string;
        product_id: string;
        variant_id: string | null;
      };
      const orderItems = (orderItemsRes.data ?? []) as OrderItemRow[];

      // Build a cart_item_id → order_item_id map by joining on
      // (product_id, variant_id). The cart's unique index guarantees
      // each (cart, product, variant) is unique, so this lookup is
      // 1:1.
      const cartItemById = new Map<string, CartRow>();
      for (const ci of items) cartItemById.set(ci.id, ci);
      const orderItemKey = (p: string, v: string | null) =>
        `${p}::${v ?? ""}`;
      const orderItemByKey = new Map<string, string>();
      for (const oi of orderItems) {
        orderItemByKey.set(orderItemKey(oi.product_id, oi.variant_id), oi.id);
      }

      const orderFieldRows: Array<{
        order_item_id: string;
        field_id: string;
        unit_index: number | null;
        value: unknown;
        contributed_price: number;
      }> = [];
      for (const cf of cartFields) {
        const cart_item = cartItemById.get(cf.cart_item_id);
        if (!cart_item) continue;
        const orderItemId = orderItemByKey.get(
          orderItemKey(cart_item.product_id, cart_item.variant_id)
        );
        if (!orderItemId) continue;
        orderFieldRows.push({
          order_item_id: orderItemId,
          field_id: cf.field_id,
          unit_index: cf.unit_index,
          value: cf.value,
          contributed_price: Number(cf.contributed_price) || 0,
        });
      }
      if (orderFieldRows.length > 0) {
        const { error: copyErr } = await admin
          .from("order_item_custom_fields")
          .insert(orderFieldRows);
        if (copyErr) {
          console.error(
            `[placeOrder] order ${order.id}: failed to copy custom fields: ${copyErr.message}`
          );
        }
      }
    }
  } catch (e) {
    console.error(
      `[placeOrder] order ${order.id}: unexpected error copying custom fields:`,
      e
    );
  }

  // ─── Offers audit + usage counters ─────────────────────
  // Best-effort: failure here doesn't roll back the order. Without these
  // rows, affiliate attribution + ROI reports will miss this order, but
  // the customer's payment + fulfillment are unaffected.
  if (appliedOffers.length > 0) {
    await recordOfferApplications(
      admin,
      order.id,
      appliedOffers,
      customer.preferred_currency ?? "EUR"
    );
  }

  // Transition the soft session to 'hard' — reservation has been promoted
  // and the order is linked. Cart_checkout_sessions reaper won't touch it
  // anymore.
  if (activeSessionId) {
    await admin
      .from("cart_checkout_sessions")
      .update({
        state: "hard",
        order_id: order.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", activeSessionId);

    // Phase 4A/4C: collapse the soft-wait queue for this session. Capture
    // the waiter set BEFORE the RPC (which deletes the rows), then insert
    // collapse_notifications AFTER for each affected (customer, variant) so
    // their global CollapseWatcher can Realtime-pop the "items sold" modal.
    //
    // Best-effort throughout — the order has already been placed, and the
    // waiter UX is informational. We log on failure but never roll back.
    type WaiterSnapshot = {
      customer_id: string;
      variant_id: string;
      product_id: string;
      product_name: string;
      product_slug: string;
      variant_label: string | null;
    };
    let waiterSnapshots: WaiterSnapshot[] = [];
    try {
      const { data: waitRows } = await admin
        .from("soft_waits")
        .select(
          "customer_id, variant_id, product_variants(attribute_combo, products(id, name, slug))"
        )
        .eq("checkout_session_id", activeSessionId);

      type WaitJoin = {
        customer_id: string;
        variant_id: string;
        product_variants:
          | {
              attribute_combo: Record<string, string> | null;
              products:
                | { id: string; name: string; slug: string }
                | { id: string; name: string; slug: string }[]
                | null;
            }
          | {
              attribute_combo: Record<string, string> | null;
              products:
                | { id: string; name: string; slug: string }
                | { id: string; name: string; slug: string }[]
                | null;
            }[]
          | null;
      };
      const joins = (waitRows ?? []) as unknown as WaitJoin[];
      const combosForLabel = joins.map((j) => {
        const v = Array.isArray(j.product_variants)
          ? j.product_variants[0]
          : j.product_variants;
        return v?.attribute_combo ?? null;
      });
      const labels = await resolveComboLabels(admin, combosForLabel);
      waiterSnapshots = joins
        .map((j, idx): WaiterSnapshot | null => {
          const v = Array.isArray(j.product_variants)
            ? j.product_variants[0]
            : j.product_variants;
          const p = v?.products
            ? Array.isArray(v.products)
              ? v.products[0]
              : v.products
            : null;
          if (!p) return null;
          return {
            customer_id: j.customer_id,
            variant_id: j.variant_id,
            product_id: p.id,
            product_name: p.name,
            product_slug: p.slug,
            variant_label: labels[idx],
          };
        })
        .filter((s): s is WaiterSnapshot => s !== null);
    } catch (e) {
      console.error(
        `[placeOrder] failed to capture waiter snapshots for collapse notifications (${activeSessionId}):`,
        e
      );
    }

    const { error: collapseErr } = await admin.rpc(
      "collapse_soft_wait_queue_for_session" as never,
      { p_session_id: activeSessionId } as never
    );
    if (collapseErr) {
      console.error(
        `[placeOrder] collapse_soft_wait_queue_for_session failed for ${activeSessionId}: ${collapseErr.message}`
      );
    } else if (waiterSnapshots.length > 0) {
      const { error: notifErr } = await admin
        .from("collapse_notifications")
        .insert(waiterSnapshots);
      if (notifErr) {
        console.error(
          `[placeOrder] failed to insert collapse_notifications for ${activeSessionId}: ${notifErr.message}`
        );
      }
    }
  }

  // Mark cart as converted — a new active cart will be auto-created on next add.
  await admin
    .from("carts")
    .update({ status: "converted", updated_at: new Date().toISOString() })
    .eq("id", cart.id);

  await logAuditEvent({
    actor_id: userId,
    actor_type: "user",
    action: "checkout.order_placed",
    resource_type: "order",
    resource_id: order.id,
    metadata: {
      order_number: order.order_number,
      payment_method: parsed.data.payment_method,
      delivery_method: parsed.data.delivery_method,
      total,
      item_count: lines.length,
    },
  });

  // Fire the order-received email (best-effort — never blocks checkout).
  if (customer.email) {
    await sendEmail({
      to: customer.email,
      subject: `Λάβαμε την παραγγελία σας ${order.order_number}`,
      text: [
        `Γεια σας ${customerName ?? ""},`,
        "",
        `Λάβαμε την παραγγελία σας με αριθμό ${order.order_number}.`,
        `Σύνολο: ${total.toFixed(2)} ${customer.preferred_currency}`,
        `Τρόπος πληρωμής: ${parsed.data.payment_method}`,
        "",
        parsed.data.payment_method === "stripe"
          ? "Παρακαλούμε ολοκληρώστε την πληρωμή για να συνεχίσουμε με την επεξεργασία."
          : "Θα σας ενημερώσουμε όταν η παραγγελία αποσταλεί.",
      ].join("\n"),
      templateId: "order.placed",
    });
  }

  revalidatePath("/checkout");
  revalidatePath("/orders");
  // Order placement reserved inventory and inserted an admin-visible
  // order row. The admin /admin/inventory page renders quantity_reserved
  // and the /admin/orders list renders the new order — both need to
  // refresh on next admin visit.
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/orders");
  return ok({
    order_id: order.id,
    order_number: order.order_number,
    next_step: parsed.data.payment_method === "stripe" ? "payment" : "success",
  });
}
