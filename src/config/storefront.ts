/**
 * Storefront business constants — payment methods, delivery methods,
 * carriers, order statuses, and country-specific validation rules.
 *
 * Every component that needs a dropdown of carriers, a list of payment
 * methods, or a country-code validator imports from here — NOT from a
 * local `const` array inside the component. This guarantees:
 *
 *   1. Adding a 7th carrier is a single-file change.
 *   2. Changing a Greek label is a single-file change.
 *   3. Different storefronts can override this file for different
 *      business configurations (e.g., a shop with no COD, or one that
 *      ships to different countries).
 *
 * See docs/RESKIN-GUIDE.md for the full reskinning guide.
 */

import type { CountryCode } from "libphonenumber-js";

// ---------------------------------------------------------------------------
// Payment methods
// ---------------------------------------------------------------------------

export type PaymentMethodValue = "stripe" | "cod" | "cash_on_pickup" | "bank_transfer";

export interface PaymentMethodOption {
  value: PaymentMethodValue;
  label: string;
  description: string;
}

export const PAYMENT_METHODS: readonly PaymentMethodOption[] = [
  {
    value: "stripe",
    label: "Πληρωμή με κάρτα (online)",
    description: "Άμεση χρέωση. Η παραγγελία προωθείται μόλις ολοκληρωθεί η πληρωμή.",
  },
  {
    value: "cod",
    label: "Αντικαταβολή (πληρωμή κατά την παράδοση)",
    description: "Πληρώνετε με μετρητά ή κάρτα στον courier όταν παραλάβετε.",
  },
  {
    value: "cash_on_pickup",
    label: "Μετρητά στο κατάστημα",
    description: "Πληρώνετε όταν παραλάβετε από το φυσικό κατάστημα.",
  },
  {
    value: "bank_transfer",
    label: "Κατάθεση σε τράπεζα",
    description: "Θα σας στείλουμε τα στοιχεία κατάθεσης μετά την υποβολή.",
  },
] as const;

/** Per-method instructions shown on the checkout success page. */
export const PAYMENT_INSTRUCTIONS: Readonly<Record<PaymentMethodValue, string>> = {
  stripe: "Η πληρωμή σας έχει ολοκληρωθεί επιτυχώς.",
  cod: "Θα πληρώσετε με μετρητά ή κάρτα στον courier όταν παραλάβετε.",
  cash_on_pickup: "Θα πληρώσετε όταν παραλάβετε από το κατάστημά μας.",
  bank_transfer:
    "Θα λάβετε email με τα στοιχεία κατάθεσης. Η παραγγελία θα προωθηθεί μόλις επιβεβαιωθεί η πληρωμή.",
};

/** Subset available for admin manual-order entry (no Stripe). */
export type ManualPaymentMethod = Exclude<PaymentMethodValue, "stripe">;

export const MANUAL_PAYMENT_METHODS: readonly PaymentMethodOption[] =
  PAYMENT_METHODS.filter((m): m is PaymentMethodOption => m.value !== "stripe");

/**
 * Label lookup for admin surfaces — short Greek captions for raw enum
 * values. Use these everywhere instead of rendering `order.payment_method`
 * directly (which would show "cod" / "bank_transfer" — internal codes
 * leaked to the user).
 */
export const PAYMENT_METHOD_SHORT_LABELS: Readonly<
  Record<PaymentMethodValue, string>
> = {
  stripe: "Stripe",
  cod: "Αντικαταβολή",
  cash_on_pickup: "Μετρητά στο κατάστημα",
  bank_transfer: "Τραπεζική κατάθεση",
};

export function paymentMethodLabel(v: PaymentMethodValue | string): string {
  return PAYMENT_METHOD_SHORT_LABELS[v as PaymentMethodValue] ?? v;
}

// ---------------------------------------------------------------------------
// Delivery methods
// ---------------------------------------------------------------------------

export type DeliveryMethodValue =
  | "home_delivery"
  | "store_pickup"
  | "delivery_station_pickup"
  | "carrier_pickup";

export interface DeliveryMethodOption {
  value: DeliveryMethodValue;
  label: string;
}

export const DELIVERY_METHODS: readonly DeliveryMethodOption[] = [
  { value: "home_delivery", label: "Παράδοση στο σπίτι" },
  { value: "store_pickup", label: "Παραλαβή από το κατάστημα" },
  { value: "delivery_station_pickup", label: "Παραλαβή από locker / σταθμό" },
  { value: "carrier_pickup", label: "Παραλαβή από κατάστημα μεταφορικής" },
] as const;

/** Short label lookup — use in tables / badges where the long-form
 *  customer-facing label is too verbose. */
export const DELIVERY_METHOD_SHORT_LABELS: Readonly<
  Record<DeliveryMethodValue, string>
> = {
  home_delivery: "Στο σπίτι",
  store_pickup: "Στο κατάστημα",
  delivery_station_pickup: "Locker",
  carrier_pickup: "Σε μεταφορική",
};

export function deliveryMethodLabel(v: DeliveryMethodValue | string): string {
  return DELIVERY_METHOD_SHORT_LABELS[v as DeliveryMethodValue] ?? v;
}

// ---------------------------------------------------------------------------
// Carriers
// ---------------------------------------------------------------------------

export type CarrierValue = "acs" | "elta" | "box_now" | "speedex" | "geniki" | "other";

export interface CarrierOption {
  value: CarrierValue;
  label: string;
}

export const CARRIERS: readonly CarrierOption[] = [
  { value: "acs", label: "ACS" },
  { value: "elta", label: "ΕΛΤΑ" },
  { value: "box_now", label: "Box Now" },
  { value: "speedex", label: "Speedex" },
  { value: "geniki", label: "Γενική Ταχυδρομική" },
  { value: "other", label: "Άλλο" },
] as const;

/** Label lookup for admin surfaces that need just the name. */
export const CARRIER_LABELS: Readonly<Record<CarrierValue, string>> =
  Object.fromEntries(CARRIERS.map((c) => [c.value, c.label])) as Record<CarrierValue, string>;

// ---------------------------------------------------------------------------
// Order statuses
// ---------------------------------------------------------------------------

// Full DB enum surface — kept in lockstep with
// supabase/migrations/20260601000023_expand_fulfillment_status.sql.
// The TS type used to be just the 9 legacy values; that's why the
// admin status dropdown was capped at 9 options. Now mirrors the
// full vocabulary so carrier-specific timelines (ACS, BoxNow, etc.)
// can actually be persisted.
export type FulfillmentStatus =
  // Pre-shipment + legacy (kept for back-compat with existing rows)
  | "draft"
  | "pending"
  | "confirmed"
  | "preparing"
  | "shipped"            // legacy → in_transit
  | "ready_for_pickup"   // legacy → arrived_at_pickup
  | "delivered"
  | "picked_up"          // legacy → collected
  | "cancelled"
  // New (Phase 2 vocabulary)
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

export const FULFILLMENT_STATUSES: readonly FulfillmentStatus[] = [
  "draft",
  "pending",
  "confirmed",
  "preparing",
  "label_created",
  "awaiting_carrier",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "ready_for_pickup",
  "arrived_at_pickup",
  "on_hold",
  "delivered",
  "picked_up",
  "collected",
  "delivery_attempted_absent",
  "delivery_attempted_refused",
  "delivery_attempted_wrong_address",
  "delivery_attempted_damaged",
  "returning",
  "returned",
  "lost",
  "cancelled",
] as const;

export type PaymentStatus = "pending" | "paid" | "refunded" | "failed";

export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "pending",
  "paid",
  "refunded",
  "failed",
] as const;

// ---------------------------------------------------------------------------
// Order sources (manual entry)
// ---------------------------------------------------------------------------

export type ManualOrderSource = "phone" | "in_store";

export interface OrderSourceOption {
  value: ManualOrderSource;
  label: string;
}

// Source labels for ADMIN-created orders only — eshop orders are
// auto-tagged "eshop" by the storefront checkout flow and are NOT
// shown in this list (admins never create eshop orders manually).
// "in_store" specifically means the physical/brick-and-mortar store;
// renamed in the label to remove the "is this online or offline?"
// ambiguity, while the enum value stays the same so the DB & schema
// don't have to migrate.
export const ORDER_SOURCES: readonly OrderSourceOption[] = [
  { value: "phone", label: "Τηλεφωνική παραγγελία" },
  { value: "in_store", label: "Φυσικό κατάστημα" },
] as const;

// ---------------------------------------------------------------------------
// Countries — merges what was previously scattered across countries.ts,
// normalize.ts, and PhoneCountryInput.tsx into one source of truth.
// ---------------------------------------------------------------------------

export interface CountryConfig {
  code: CountryCode;
  label: string;
  callingCode: string;
  /** Max subscriber-digit count for phone numbers. null = no hard cap. */
  maxPhoneDigits: number | null;
  /** Expected ZIP/postal-code length (digits). null = variable (e.g. UK). */
  zipLength: number | null;
}

export const SUPPORTED_COUNTRIES: readonly CountryConfig[] = [
  { code: "GR", label: "GR", callingCode: "+30", maxPhoneDigits: 10, zipLength: 5 },
  { code: "CY", label: "CY", callingCode: "+357", maxPhoneDigits: 8, zipLength: 4 },
  { code: "BG", label: "BG", callingCode: "+359", maxPhoneDigits: 9, zipLength: 4 },
  { code: "RO", label: "RO", callingCode: "+40", maxPhoneDigits: 9, zipLength: 6 },
  { code: "IT", label: "IT", callingCode: "+39", maxPhoneDigits: 10, zipLength: 5 },
  { code: "DE", label: "DE", callingCode: "+49", maxPhoneDigits: 11, zipLength: 5 },
  { code: "FR", label: "FR", callingCode: "+33", maxPhoneDigits: 9, zipLength: 5 },
  { code: "ES", label: "ES", callingCode: "+34", maxPhoneDigits: 9, zipLength: 5 },
  { code: "GB", label: "GB", callingCode: "+44", maxPhoneDigits: 10, zipLength: null },
] as const;

export const DEFAULT_COUNTRY: CountryCode = "GR";

/** Quick lookup helpers derived from the config. */
export const MAX_PHONE_DIGITS_BY_COUNTRY: Readonly<Partial<Record<CountryCode, number>>> =
  Object.fromEntries(
    SUPPORTED_COUNTRIES.filter((c) => c.maxPhoneDigits !== null).map((c) => [c.code, c.maxPhoneDigits!])
  );

export const ZIP_LENGTH_BY_COUNTRY: Readonly<Record<string, number>> =
  Object.fromEntries(
    SUPPORTED_COUNTRIES.filter((c) => c.zipLength !== null).map((c) => [c.code, c.zipLength!])
  );
