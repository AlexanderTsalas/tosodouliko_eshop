import type { BuiltInCarrierSlug } from "./carrier-slugs";
import type { DeliveryMethodValue } from "./storefront";

/**
 * Physical capability ceiling per built-in carrier — the FULL set of
 * delivery methods each carrier is physically capable of fulfilling. The
 * admin may NARROW these via the Couriers settings page (e.g. disable
 * branch pickup for Speedex if they don't want to offer it), but cannot
 * EXPAND beyond this ceiling: BoxNow can't ship a home delivery just
 * because the admin checks the box.
 *
 * Enforced at three layers (defence in depth):
 *
 *   1. UI (DeliveryCarrierForm)        — checkboxes outside the ceiling
 *                                        don't render for built-ins
 *   2. Server action (updateCarrier)   — rejects the submission with a
 *                                        BUILTIN_METHOD_NOT_SUPPORTED code
 *   3. Database (delivery_carriers trigger)
 *                                      — fail-closed last line so any path
 *                                        bypassing the action (direct SQL,
 *                                        future admin tools) still gets
 *                                        blocked
 *
 * Custom carriers (`is_custom=true`) are NOT constrained by this ceiling —
 * admins know what their custom carrier physically does.
 *
 * When a built-in carrier expands its real-world capabilities (e.g. BoxNow
 * launches home delivery), update the entry below + the matching CASE in
 * the database trigger migration.
 */
export const BUILT_IN_CARRIER_MAX_DELIVERY_METHODS: Record<
  BuiltInCarrierSlug,
  DeliveryMethodValue[]
> = {
  acs: ["home_delivery", "delivery_station_pickup", "carrier_pickup"],
  elta: ["home_delivery", "delivery_station_pickup", "carrier_pickup"],
  // BoxNow is a locker-only network. They have no home-delivery riders and
  // no retail branches. Locking this down at the type + DB level prevents
  // an admin accidentally surfacing BoxNow for home delivery, which would
  // create unfulfillable orders.
  box_now: ["delivery_station_pickup"],
  // Speedex operates a courier + branch network AND a Service Point /
  // locker network. ELTA's equivalent is PostBox (covered by ELTA's own
  // entry above).
  speedex: ["home_delivery", "delivery_station_pickup", "carrier_pickup"],
  geniki: ["home_delivery", "delivery_station_pickup", "carrier_pickup"],
  // 'other' is the legacy catch-all being deleted in
  // 20260603000002_drop_other_carrier_seed.sql. Kept in the map only to
  // satisfy the Record's exhaustiveness; if the slug exists in the DB,
  // the trigger lets it through any set.
  other: ["home_delivery", "store_pickup", "delivery_station_pickup", "carrier_pickup"],
};
