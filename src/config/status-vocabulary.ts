/**
 * Status vocabulary — see "Status vocabulary" section of
 * docs/features/courier-integration-design.md.
 *
 * Four-layer architecture:
 *
 *   StatusCode                    — one shared enum, rich vocabulary
 *      ↓
 *   STATUS_LABELS[code]           — per audience (admin / customer)
 *      ↓
 *   PHASE_OF[code]: Phase         — derived 5-6 bucket aggregate
 *      ↓
 *   TIMELINE_BY_CARRIER[carrier]  — ordered codes per carrier (in status-timelines.ts)
 *      ↓
 *   API_MAPPING_BY_CARRIER        — bidirectional carrier-native ↔ StatusCode
 *
 * The codes are shared across all carriers. Per-carrier nuance lives in the
 * timeline (which subset + ordering) and the API mapping (translation to the
 * carrier's native vocabulary), not in carrier-specific copies of each code.
 *
 * Legacy values from the original FulfillmentStatus enum (`shipped`,
 * `ready_for_pickup`, `picked_up`) still exist in the database enum and in
 * `src/types/order-history.ts` for back-compat. They map to:
 *   shipped          → in_transit
 *   ready_for_pickup → arrived_at_pickup
 *   picked_up        → collected
 *
 * The migration path is: backfill orders with the new code, then a later
 * phase drops the legacy enum values.
 */

// ---------------------------------------------------------------------------
// StatusCode — 18 codes covering the full package lifecycle
// ---------------------------------------------------------------------------

export type StatusCode =
  // Pre-shipment (merchant-controlled, no carrier API involvement)
  | "draft"
  | "pending"
  | "confirmed"
  | "preparing"

  // Carrier-driven main path
  | "label_created"
  | "awaiting_carrier"
  | "in_transit"
  | "out_for_delivery"
  | "arrived_at_pickup"
  | "on_hold"
  | "delivered"               // door delivery
  | "collected"               // locker / branch pickup

  // Exception sub-states (granular reasons for failed delivery)
  | "delivery_attempted_absent"
  | "delivery_attempted_refused"
  | "delivery_attempted_wrong_address"
  | "delivery_attempted_damaged"

  // Terminal exceptions
  | "returning"
  | "returned"
  | "cancelled"
  | "lost";

/** Frozen array form for runtime iteration (admin dropdowns, validation). */
export const STATUS_CODES = [
  "draft",
  "pending",
  "confirmed",
  "preparing",
  "label_created",
  "awaiting_carrier",
  "in_transit",
  "out_for_delivery",
  "arrived_at_pickup",
  "on_hold",
  "delivered",
  "collected",
  "delivery_attempted_absent",
  "delivery_attempted_refused",
  "delivery_attempted_wrong_address",
  "delivery_attempted_damaged",
  "returning",
  "returned",
  "cancelled",
  "lost",
] as const satisfies readonly StatusCode[];

// ---------------------------------------------------------------------------
// Phase — derived 5-bucket aggregate for cross-carrier filtering / reports
// ---------------------------------------------------------------------------

/**
 * Coarse status categories used for analytics, dashboards, business rules
 * that span carriers (e.g. "send a CSAT email after `completed`"), and
 * admin order-list filters.
 *
 * Derived from StatusCode via PHASE_OF — not stored separately to avoid
 * the consistency problem of having two columns to keep in sync.
 */
export type Phase =
  | "draft"
  | "pre_shipment"
  | "in_transit"
  | "at_destination"
  | "completed"
  | "exception";

export const PHASE_OF: Record<StatusCode, Phase> = {
  draft: "draft",

  pending: "pre_shipment",
  confirmed: "pre_shipment",
  preparing: "pre_shipment",
  label_created: "pre_shipment",
  awaiting_carrier: "pre_shipment",

  in_transit: "in_transit",
  out_for_delivery: "in_transit",

  arrived_at_pickup: "at_destination",
  on_hold: "at_destination",

  delivered: "completed",
  collected: "completed",

  delivery_attempted_absent: "exception",
  delivery_attempted_refused: "exception",
  delivery_attempted_wrong_address: "exception",
  delivery_attempted_damaged: "exception",
  returning: "exception",
  returned: "exception",
  cancelled: "exception",
  lost: "exception",
};

/** Convenience: derive phase from any StatusCode. */
export function phaseOf(code: StatusCode): Phase {
  return PHASE_OF[code];
}

// ---------------------------------------------------------------------------
// STATUS_LABELS — per-audience Greek display labels
// ---------------------------------------------------------------------------

/**
 * Two labels per code:
 *   admin    — for backoffice surfaces; terse and operational
 *   customer — for customer-facing surfaces; warmer, second-person
 *
 * Both are Greek. Adding English (or any other locale) would mean expanding
 * this shape to `Record<StatusCode, Record<Audience, Record<Locale, string>>>`
 * — defer until there's a real localization need.
 */
export interface StatusLabel {
  admin: string;
  customer: string;
}

export const STATUS_LABELS: Record<StatusCode, StatusLabel> = {
  draft: {
    admin: "Πρόχειρο",
    customer: "Σε προετοιμασία",
  },
  pending: {
    admin: "Εκκρεμεί επιβεβαίωση",
    customer: "Αναμονή επιβεβαίωσης πληρωμής",
  },
  confirmed: {
    admin: "Επιβεβαιωμένη",
    customer: "Η παραγγελία σας επιβεβαιώθηκε",
  },
  preparing: {
    admin: "Σε προετοιμασία",
    customer: "Ετοιμάζουμε την παραγγελία σας",
  },
  label_created: {
    admin: "Δημιουργήθηκε voucher",
    customer: "Έτοιμη για παραλαβή από courier",
  },
  awaiting_carrier: {
    admin: "Αναμονή παραλαβής από courier",
    customer: "Σύντομα θα παραλάβει ο courier",
  },
  in_transit: {
    admin: "Σε μεταφορά",
    customer: "Η παραγγελία σας ταξιδεύει",
  },
  out_for_delivery: {
    admin: "Προς παράδοση",
    customer: "Η παραγγελία σας παραδίδεται σήμερα",
  },
  arrived_at_pickup: {
    admin: "Στο σημείο παραλαβής",
    customer: "Διαθέσιμη στο σημείο παραλαβής",
  },
  on_hold: {
    admin: "Σε αναμονή",
    customer: "Καθυστέρηση στην παράδοση",
  },
  delivered: {
    admin: "Παραδόθηκε στην πόρτα",
    customer: "Η παραγγελία σας παραδόθηκε",
  },
  collected: {
    admin: "Παραλήφθηκε από locker / κατάστημα",
    customer: "Παραλήφθηκε από το σημείο παραλαβής",
  },
  delivery_attempted_absent: {
    admin: "Απουσία παραλήπτη",
    customer: "Δεν βρεθήκατε για την παράδοση",
  },
  delivery_attempted_refused: {
    admin: "Άρνηση παραλαβής",
    customer: "Η παραλαβή απορρίφθηκε",
  },
  delivery_attempted_wrong_address: {
    admin: "Λανθασμένη διεύθυνση",
    customer: "Η διεύθυνση δεν εντοπίστηκε",
  },
  delivery_attempted_damaged: {
    admin: "Ζημιά στη μεταφορά",
    customer: "Παρουσιάστηκε πρόβλημα στη μεταφορά",
  },
  returning: {
    admin: "Επιστρέφεται",
    customer: "Η παραγγελία επιστρέφεται σε εμάς",
  },
  returned: {
    admin: "Επιστράφηκε",
    customer: "Η παραγγελία επιστράφηκε",
  },
  cancelled: {
    admin: "Ακυρώθηκε",
    customer: "Η παραγγελία ακυρώθηκε",
  },
  lost: {
    admin: "Χάθηκε",
    customer: "Η παραγγελία αναζητείται",
  },
};

/** Convenience: pull the admin label for a code. */
export function adminLabelOf(code: StatusCode): string {
  return STATUS_LABELS[code].admin;
}

/** Convenience: pull the customer label for a code. */
export function customerLabelOf(code: StatusCode): string {
  return STATUS_LABELS[code].customer;
}

// ---------------------------------------------------------------------------
// Legacy → new mapping
// ---------------------------------------------------------------------------

/**
 * Legacy status codes from the original FulfillmentStatus enum, mapped to
 * the new shared vocabulary. Useful for:
 *   - Backfilling orders with old statuses
 *   - Reading legacy rows during the transition
 *   - Test fixtures that still reference legacy codes
 *
 * Drops once all consumers move to StatusCode.
 */
export type LegacyStatusCode = "shipped" | "ready_for_pickup" | "picked_up";

export const LEGACY_TO_NEW: Record<LegacyStatusCode, StatusCode> = {
  shipped: "in_transit",
  ready_for_pickup: "arrived_at_pickup",
  picked_up: "collected",
};

/**
 * Coerces a raw status string (which may be legacy or new) to the canonical
 * StatusCode. Unknown strings pass through unchanged — typed as StatusCode
 * by the cast but callers should validate at trust boundaries (Zod).
 */
export function normalizeStatusCode(raw: string): StatusCode {
  if (raw in LEGACY_TO_NEW) return LEGACY_TO_NEW[raw as LegacyStatusCode];
  return raw as StatusCode;
}
