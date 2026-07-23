import type {
  DeliveryMethodValue,
  PaymentMethodValue,
} from "./storefront";
import {
  isBuiltInCarrier,
  type BuiltInCarrierSlug,
  type CarrierSlug,
} from "./carrier-slugs";
import type { DeliveryCarrier } from "@/lib/courier/listActiveCarriers";

/**
 * Single source of truth for which combinations of
 * (delivery_method, payment_method, carrier) are valid at checkout.
 *
 * Both the client checkout UI and the server placeOrder action import from
 * here so that:
 *   - the UI greys out impossible options as the user makes selections
 *   - a curl-bypass of the UI still hits a structural validation gate
 *     before any DB write
 *
 * Three derived helpers (`availableDeliveryMethods`, `availablePaymentMethods`,
 * `availableCarriers`) drive the UI; `isCompatible` answers the final yes/no
 * the server enforces.
 *
 * Auto-reset behaviour (when the user switches one field and orphans
 * another) is implemented in CheckoutForm via a useEffect that reads from
 * these helpers; it does NOT live here. This file is pure data + pure
 * functions.
 *
 * Phase 1 (active carrier visibility): every helper that touches carriers
 * now takes `activeCarriers: DeliveryCarrier[]` from `listActiveCarriers()`
 * as an explicit argument. The supported-delivery-methods axis for each
 * carrier is read from the row (`supported_delivery_methods`), not from a
 * hardcoded map. Built-in carriers seed those values to match what the
 * provider class structurally supports; admins can narrow them per merchant.
 */

// ---------------------------------------------------------------------------
// Matrices
// ---------------------------------------------------------------------------

/**
 * Baseline payment methods per delivery method — what's safe to offer
 * before knowing which carrier will fulfill.
 *   - stripe / bank_transfer: payment is offline-of-fulfillment, valid everywhere
 *   - cod: requires a collector at delivery → conservative default of NOT
 *     offering at lockers (most locker networks have no human/no payment
 *     terminal). Carriers that actually support locker-COD override this
 *     below.
 *   - cash_on_pickup: only when the customer comes to OUR store
 */
const PAYMENT_BY_DELIVERY: Record<DeliveryMethodValue, PaymentMethodValue[]> = {
  home_delivery: ["stripe", "cod", "bank_transfer"],
  store_pickup: ["stripe", "cash_on_pickup", "bank_transfer"],
  delivery_station_pickup: ["stripe", "bank_transfer"],
  carrier_pickup: ["stripe", "cod", "bank_transfer"],
};

/**
 * Carrier-specific payment capabilities that override or extend the
 * baseline above. Currently only BoxNow supports COD at the locker
 * (customer pays via app before opening, lifecycle pending →
 * paid-by-customer → transferred-to-partner). ACS Smartpoints, ELTA APMs,
 * and Geniki third-party lockers have no documented COD flow → use the
 * conservative baseline.
 *
 * Shape: PAYMENT_OVERRIDES[carrier][delivery] = additional methods to OR
 * into the baseline for that (carrier, delivery) pair. Keyed by
 * BuiltInCarrierSlug — custom carriers can't have hardcoded overrides
 * (they take the conservative baseline).
 */
const PAYMENT_OVERRIDES: Partial<
  Record<BuiltInCarrierSlug, Partial<Record<DeliveryMethodValue, PaymentMethodValue[]>>>
> = {
  box_now: {
    delivery_station_pickup: ["cod"],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Payment methods valid for this delivery method, accounting for the
 * chosen carrier's specific capabilities (e.g. BoxNow allows COD at
 * locker; ACS Smartpoint does not). When `carrier` is null or unknown the
 * baseline is returned.
 *
 * The carrier-specific override is keyed by built-in slug — custom
 * carriers get the baseline (no hardcoded extras). If a merchant needs
 * a custom carrier to support COD at locker, model it in custom fee
 * rules rather than here.
 */
export function availablePaymentMethods(
  delivery: DeliveryMethodValue,
  carrier: CarrierSlug | null = null
): PaymentMethodValue[] {
  const baseline = PAYMENT_BY_DELIVERY[delivery];
  const extras =
    carrier && isBuiltInCarrier(carrier)
      ? (PAYMENT_OVERRIDES[carrier]?.[delivery] ?? [])
      : [];
  if (extras.length === 0) return baseline;
  const combined = new Set<PaymentMethodValue>([...baseline, ...extras]);
  return Array.from(combined);
}

/**
 * Returns the active carriers that can fulfil this delivery method.
 * Empty array for `store_pickup` (no carrier needed) and when no active
 * carrier supports the method.
 *
 * The carrier row's `supported_delivery_methods` is the truth — admins
 * may narrow the built-in default; custom carriers declare their own.
 */
export function availableCarriers(
  delivery: DeliveryMethodValue,
  activeCarriers: DeliveryCarrier[]
): DeliveryCarrier[] {
  if (delivery === "store_pickup") return [];
  return activeCarriers.filter((c) =>
    c.supported_delivery_methods.includes(delivery)
  );
}

/**
 * Delivery methods that should appear in the checkout UI given the current
 * carrier choice and the active-carrier set.
 *
 *   - `store_pickup` is always available (no carrier needed).
 *   - When `carrier` is null: include any method that has AT LEAST ONE
 *     active supporting carrier.
 *   - When `carrier` is set: include the methods this specific carrier
 *     supports. If the carrier isn't in the active list (stale selection),
 *     only `store_pickup` is offered.
 */
export function availableDeliveryMethods(
  carrier: CarrierSlug | null,
  activeCarriers: DeliveryCarrier[]
): DeliveryMethodValue[] {
  if (carrier === null) {
    const present = new Set<DeliveryMethodValue>(["store_pickup"]);
    for (const c of activeCarriers) {
      for (const m of c.supported_delivery_methods) present.add(m);
    }
    // Preserve canonical ordering rather than insertion order.
    return (
      ["home_delivery", "store_pickup", "delivery_station_pickup", "carrier_pickup"] as DeliveryMethodValue[]
    ).filter((m) => present.has(m));
  }
  const found = activeCarriers.find((c) => c.slug === carrier);
  if (!found) return ["store_pickup"];
  return ["store_pickup", ...found.supported_delivery_methods];
}

/**
 * Final structural check used by the server. Returns a Greek user-facing
 * reason on failure so callers can surface it directly.
 *
 * Validates BOTH the structural rules (delivery × payment × carrier
 * combinations) AND that the named carrier is currently in the active set.
 * The active-carrier check defends against curl-bypass requests that name
 * a carrier the admin hasn't enabled.
 */
export function isCompatible(
  delivery: DeliveryMethodValue,
  payment: PaymentMethodValue,
  carrier: CarrierSlug | null,
  activeCarriers: DeliveryCarrier[]
):
  | { ok: true }
  | { ok: false; reason: string } {
  if (delivery === "store_pickup") {
    if (carrier !== null) {
      return { ok: false, reason: "Η παραλαβή από το κατάστημα δεν χρειάζεται μεταφορική." };
    }
  } else {
    if (carrier === null) {
      return { ok: false, reason: "Επιλέξτε μεταφορική." };
    }
    const found = activeCarriers.find((c) => c.slug === carrier);
    if (!found) {
      return {
        ok: false,
        reason: "Η επιλεγμένη μεταφορική δεν είναι διαθέσιμη.",
      };
    }
    if (!found.supported_delivery_methods.includes(delivery)) {
      return {
        ok: false,
        reason: "Η επιλεγμένη μεταφορική δεν υποστηρίζει αυτόν τον τρόπο παράδοσης.",
      };
    }
  }

  if (!availablePaymentMethods(delivery, carrier).includes(payment)) {
    return {
      ok: false,
      reason: "Ο επιλεγμένος τρόπος πληρωμής δεν είναι διαθέσιμος για αυτόν τον τρόπο παράδοσης.",
    };
  }

  return { ok: true };
}
