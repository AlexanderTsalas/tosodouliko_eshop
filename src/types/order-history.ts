/**
 * Customer orders.
 *
 * Three orthogonal axes describe an order's shape, set at creation and (mostly)
 * immutable afterwards:
 *
 *   - payment_method:  how the customer pays the money
 *   - delivery_method: how the items reach the customer
 *   - source:          where the order was created
 *
 * Two independent state machines describe its lifecycle:
 *
 *   - payment_status:     pending → paid → refunded / failed
 *   - fulfillment_status: draft → pending → confirmed → preparing
 *                         → shipped / ready_for_pickup
 *                         → delivered / picked_up
 *                         (cancelled is reachable from most states)
 *
 * Inventory rule (enforced in server actions, not the DB):
 *   - ALL payment methods reserve inventory at order placement (Phase 1 of
 *     the inventory-contention design — see
 *     docs/features/inventory-contention-and-notifications.md).
 *   - Stripe orders: reservation is consumed when the Stripe Checkout Session
 *     fires `checkout.session.completed` (payment_status flips to 'paid').
 *   - Non-Stripe orders (COD, cash_on_pickup, bank_transfer): reservation is
 *     consumed when fulfillment_status reaches 'delivered' or 'picked_up'
 *     AND payment_status='paid'.
 *   - In all cases, cancel before consume releases the reservation; cancel
 *     after consume restores stock via restore_inventory.
 */

export type PaymentMethod = "stripe" | "cod" | "cash_on_pickup" | "bank_transfer";

export type DeliveryMethod =
  | "home_delivery"
  | "store_pickup"
  | "delivery_station_pickup"
  | "carrier_pickup";

export type Carrier =
  | "acs"
  | "elta"
  | "box_now"
  | "speedex"
  | "geniki"
  | "other";

export type OrderSource = "eshop" | "phone" | "in_store";

export type PaymentStatus = "pending" | "paid" | "refunded" | "failed";

// Mirrors the DB enum order_fulfillment_status — see
// supabase/migrations/20260601000023_expand_fulfillment_status.sql.
// Keep this union in lockstep with config/storefront.ts's
// FulfillmentStatus (the two are intentionally duplicated to keep
// type-only consumers free of the heavier storefront barrel).
export type FulfillmentStatus =
  | "draft"
  | "pending"
  | "confirmed"
  | "preparing"
  | "shipped"
  | "ready_for_pickup"
  | "delivered"
  | "picked_up"
  | "cancelled"
  | "label_created"
  | "awaiting_carrier"
  | "in_transit"
  | "out_for_delivery"
  | "arrived_at_pickup"
  | "on_hold"
  | "collected"
  | "delivery_attempted_absent"
  | "delivery_attempted_refused"
  | "delivery_attempted_wrong_address"
  | "delivery_attempted_damaged"
  | "returning"
  | "returned"
  | "lost";

export interface Order {
  id: string;
  order_number: string;
  /**
   * Business-entity customer (always set). May or may not be linked to an
   * auth.users — admin-curated phone/in-store customers have customer_id
   * but no auth account.
   */
  customer_id: string;
  /**
   * Contact info snapshotted at order creation. Stays frozen even if the
   * customer later corrects their name/email/phone. Use for invoices and
   * receipts; use the live customer record for support lookups.
   */
  customer_name_at_order: string | null;
  customer_email_at_order: string | null;
  customer_phone_at_order: string | null;
  /** Admin who manually created this order, if any. */
  created_by: string | null;

  payment_method: PaymentMethod;
  delivery_method: DeliveryMethod;
  /** Null when delivery_method='store_pickup' (no carrier) or admin hasn't picked yet. */
  carrier: Carrier | null;
  source: OrderSource;

  payment_status: PaymentStatus;
  fulfillment_status: FulfillmentStatus;

  currency: string;
  subtotal: number;
  discount_amount: number;
  /**
   * Resolved shipping line — kept for back-compat with reports and the legacy
   * "total = sum of these columns" code path. Mirrors the `shipping` entry in
   * fees_breakdown.
   */
  shipping_amount: number;
  tax_amount: number;
  /** Sum of fees_breakdown[].charged — populated by the fee resolver. */
  fees_total: number;
  /**
   * Per-category snapshot of all fees applied at order time (shipping, COD,
   * any user-defined categories). See FeeBreakdownEntry in types/fee.ts.
   */
  fees_breakdown: import("./fee").FeeBreakdownEntry[];
  total: number;
  shipping_address: Record<string, unknown> | null;
  billing_address: Record<string, unknown> | null;
  notes: string | null;

  /**
   * Phase 3 tracking model.
   *   tracking_number       — set by createVoucher (API) or manual admin entry
   *   tracking_url_override — one-off URL when carrier's template doesn't apply
   *
   * The customer-facing "Track on {carrier}" button is built from these +
   * delivery_carriers.tracking_url_template via buildTrackingUrl().
   */
  tracking_number: string | null;
  tracking_url_override: string | null;

  /**
   * Phase 7 pickup point selection. Populated when delivery_method is
   * `delivery_station_pickup` (locker) or `carrier_pickup` (branch).
   *
   *   pickup_carrier    — slug of the carrier whose location was picked
   *                       (typically matches carrier_slug)
   *   pickup_station_id — carrier-native location id (ACS station code,
   *                       BoxNow locationId, Geniki locker id)
   *   pickup_branch_id  — ACS sub-branch index (0/1); null for other carriers
   *   pickup_type       — "locker" or "branch"
   *
   * All null for home_delivery, store_pickup, and for BoxNow "any-apm"
   * deferred-selection orders.
   */
  pickup_carrier: string | null;
  pickup_station_id: string | null;
  pickup_branch_id: number | null;
  pickup_type: "locker" | "branch" | null;

  /**
   * Phase 2 status-audit fields. Preserved alongside fulfillment_status to
   * surface the carrier's native status detail without flattening Geniki's
   * 11 attempt sub-reasons (et al) into a generic delivery_attempted.
   */
  carrier_raw_status: string | null;
  carrier_status_label: string | null;
  carrier_status_updated_at: string | null;
  status_set_by: "api" | "merchant" | null;

  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  variant_id: string | null;
  product_name: string;
  variant_label: string | null;
  sku: string | null;
  quantity: number;
  unit_price: number;
  total: number;
  created_at: string;
}

export interface OrderWithItems extends Order {
  items: OrderItem[];
}

/**
 * True when this order has any inventory state held — either an active
 * reservation (units in quantity_reserved) or a consumed reservation
 * (the units have already been decremented but cancellation can still
 * restore them via restore_inventory).
 *
 * Post-Phase 1: every non-draft non-cancelled order has an inventory effect,
 * regardless of payment method, because placement always reserves.
 */
export function hasInventoryEffect(order: Pick<Order, "payment_method" | "payment_status" | "fulfillment_status">): boolean {
  if (order.fulfillment_status === "draft" || order.fulfillment_status === "cancelled") {
    return false;
  }
  return true;
}

/**
 * True when this order's reservation has been consumed — the units have been
 * permanently decremented from quantity_available. Cancelling a consumed
 * order calls restore_inventory (simple increment) rather than
 * release_reservation (move from reserved back to available).
 *
 * Consumption points:
 *   - Stripe: webhook checkout.session.completed sets payment_status='paid'
 *     and calls consume_reservation via fulfillOrder.
 *   - Non-Stripe: transitionOrderStatus calls consume_reservation when
 *     fulfillment_status reaches delivered/picked_up + payment_status='paid'.
 */
export function isReservationConsumed(order: Pick<Order, "payment_method" | "payment_status" | "fulfillment_status">): boolean {
  if (order.fulfillment_status === "draft" || order.fulfillment_status === "cancelled") {
    return false;
  }
  if (order.payment_method === "stripe") {
    return order.payment_status === "paid";
  }
  return (
    (order.fulfillment_status === "delivered" || order.fulfillment_status === "picked_up") &&
    order.payment_status === "paid"
  );
}
