/**
 * Build the customer-facing "Track on {carrier}" URL for an order.
 *
 * Resolution order (per the tracking model in
 * docs/features/courier-integration-design.md):
 *
 *   1. order.tracking_url_override (set)             → use as-is
 *   2. carrier.tracking_url_template + tracking_number → template.replace('{voucher}', number)
 *   3. otherwise                                       → null (no button shown)
 *
 * Returns null whenever the order doesn't have enough information to build
 * a working URL. Callers MUST treat null as "don't render the button"
 * rather than rendering a broken link.
 *
 * Pure function, no IO — order + carrier rows are passed in.
 */

import type { DeliveryCarrier } from "./listActiveCarriers";

export interface TrackableOrder {
  tracking_number: string | null;
  tracking_url_override: string | null;
}

/**
 * Subset of delivery_carriers needed to build the URL. Accepts the full
 * DeliveryCarrier row from listActiveCarriers, OR a minimal shape if the
 * admin order page reads the carrier separately.
 */
export interface TrackingCarrierInfo {
  tracking_url_template: string | null;
}

export function buildTrackingUrl(
  order: TrackableOrder,
  carrier: TrackingCarrierInfo | null
): string | null {
  // 1. Override wins. The merchant explicitly set this URL for THIS order,
  //    so no template logic — return it verbatim.
  if (order.tracking_url_override && order.tracking_url_override.trim() !== "") {
    return order.tracking_url_override.trim();
  }

  // 2. Template + voucher number. Need both, plus a valid template containing
  //    the {voucher} placeholder (so we don't return a broken URL like
  //    "https://acs.gr/track?p=" when the template is misconfigured).
  if (
    carrier &&
    carrier.tracking_url_template &&
    order.tracking_number &&
    order.tracking_number.trim() !== ""
  ) {
    const template = carrier.tracking_url_template;
    const number = order.tracking_number.trim();
    if (template.includes("{voucher}")) {
      return template.replace("{voucher}", encodeURIComponent(number));
    }
    // Template doesn't have the placeholder — append the number as a query
    // param as a defensive fallback. Better than nothing for a misconfigured
    // template that admin can fix later.
    const separator = template.includes("?") ? "&" : "?";
    return `${template}${separator}voucher=${encodeURIComponent(number)}`;
  }

  // 3. Nothing renderable.
  return null;
}

/**
 * Convenience for admin surfaces: returns true if the order has any way
 * to produce a tracking URL (override OR voucher+template), false
 * otherwise. Useful for "show/hide tracking button" decisions without
 * computing the URL string.
 */
export function hasTrackingUrl(
  order: TrackableOrder,
  carrier: TrackingCarrierInfo | null
): boolean {
  return buildTrackingUrl(order, carrier) !== null;
}
