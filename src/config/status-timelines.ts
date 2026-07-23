/**
 * Per-carrier status timelines — see "Status vocabulary" section of
 * docs/features/courier-integration-design.md.
 *
 * Each timeline declares which StatusCodes apply to that carrier and in
 * what order. Used to drive:
 *   - The customer-facing status timeline visualization on the order page
 *   - The admin's "next valid status" suggester
 *   - Filtering of the admin status dropdown so a BoxNow order doesn't show
 *     `out_for_delivery` as an option (BoxNow conflates that into in_transit)
 *
 * The status codes themselves are shared across carriers (one
 * `StatusCode` enum) — only the subset and ordering varies per carrier.
 * This preserves cross-carrier reporting (`WHERE status = 'delivered'`
 * works across all carriers) while letting each carrier model its actual
 * operational flow.
 *
 * Built-in carriers have hardcoded timelines defined here. Custom
 * (admin-created) carriers either:
 *   - Reuse a preset (the merchant picks one from a dropdown when creating
 *     the carrier; e.g., "ACS-style with home delivery")
 *   - Define their own subset of StatusCode via the admin UI
 *     (stored in delivery_carriers.timeline_preset, parsed here)
 */

import type { BuiltInCarrierSlug, CarrierSlug } from "./carrier-slugs";
import type { StatusCode } from "./status-vocabulary";

/**
 * A stage in a carrier's timeline.
 *
 *   isMain        — appears on the main-spine progress bar (the happy path)
 *   exception     — represents an exception branch (failed delivery, return,
 *                   cancellation); rendered as a side-branch on the timeline
 *                   rather than on the main spine
 *   terminal      — no further status transitions from here
 *   branchesFrom  — for exception stages: which main-spine stage this branch
 *                   sprouts next to vertically. Drives the renderer's "draw
 *                   the arrow from row N to the side" decision. Defaults
 *                   to 'out_for_delivery' when unset (most-common case).
 *   rejoinsAt     — for non-terminal exception stages: which main-spine
 *                   stage the branch rejoins after the issue is resolved
 *                   (e.g. on_hold → in_transit). Drives the loop-back
 *                   arrow. Defaults to branchesFrom (retry-in-place).
 *
 * Convention for the admin timeline:
 *   - Exception sides: TERMINAL exceptions sprout RIGHT (no return),
 *     RECOVERABLE exceptions sprout LEFT (loop back to spine).
 *   - The side is derived from `terminal`, not stored separately.
 */
export interface CarrierTimelineStage {
  code: StatusCode;
  isMain?: boolean;
  exception?: boolean;
  terminal?: boolean;
  branchesFrom?: StatusCode;
  rejoinsAt?: StatusCode;
}

export interface CarrierTimeline {
  carrier: CarrierSlug;
  stages: CarrierTimelineStage[];
}

// ---------------------------------------------------------------------------
// Universal pre-shipment stages — every carrier's timeline starts the same
// way because these are merchant-controlled, no carrier API involvement.
// ---------------------------------------------------------------------------

const PRE_SHIPMENT: CarrierTimelineStage[] = [
  { code: "draft", isMain: false },
  { code: "pending", isMain: true },
  { code: "confirmed", isMain: true },
  { code: "preparing", isMain: true },
];

// ---------------------------------------------------------------------------
// Built-in carrier timelines
// ---------------------------------------------------------------------------

/**
 * ACS — supports home delivery, branch pickup, and Smartpoint lockers.
 * Surfaces fine-grained delivery-attempt sub-reasons via shipment_status +
 * non_delivery_reason_code mapping (see mapAcsShipmentStatus in the design
 * doc). Does not surface `awaiting_carrier` distinctly — goes
 * label_created → in_transit directly when Issue_Pickup_List runs.
 */
const ACS_TIMELINE: CarrierTimeline = {
  carrier: "acs",
  stages: [
    ...PRE_SHIPMENT,
    { code: "label_created", isMain: true },
    // ACS exposes a real "voucher issued, awaiting pickup from sender"
    // window via Issue_Pickup_List — surface it so the admin sees the
    // distinct "waiting for ACS to collect" phase between label and
    // first scan-in.
    { code: "awaiting_carrier", isMain: true },
    { code: "in_transit", isMain: true },
    { code: "out_for_delivery", isMain: true },
    // Branch / Smartpoint orders pass through arrived_at_pickup → collected.
    // Door-delivery orders skip arrived_at_pickup and land at delivered.
    { code: "arrived_at_pickup", isMain: true },
    { code: "delivered", isMain: true, terminal: true },
    { code: "collected", isMain: true, terminal: true },
    // Exception branches. branchesFrom drives WHERE the side branch
    // visually sprouts off the main spine; rejoinsAt drives where a
    // recoverable branch loops back. Side (left vs right) is derived
    // from `terminal` at render time.
    { code: "delivery_attempted_absent",        exception: true, branchesFrom: "out_for_delivery", rejoinsAt: "out_for_delivery" },
    { code: "delivery_attempted_refused",       exception: true, branchesFrom: "out_for_delivery", rejoinsAt: "out_for_delivery" },
    { code: "delivery_attempted_wrong_address", exception: true, branchesFrom: "out_for_delivery", rejoinsAt: "out_for_delivery" },
    // ACS reports damage via non_delivery_reason_code ΖΗ* — admins need
    // to see this distinctly from absent/refused so they can route to
    // returns processing rather than a re-delivery attempt.
    { code: "delivery_attempted_damaged",       exception: true, branchesFrom: "out_for_delivery", rejoinsAt: "out_for_delivery" },
    { code: "on_hold",                          exception: true, branchesFrom: "in_transit",       rejoinsAt: "in_transit" },
    { code: "returning",                        exception: true, branchesFrom: "out_for_delivery", rejoinsAt: "out_for_delivery" },
    { code: "returned",  exception: true, terminal: true, branchesFrom: "out_for_delivery" },
    { code: "cancelled", exception: true, terminal: true, branchesFrom: "confirmed" },
  ],
};

/**
 * BoxNow — locker-only. Exposes `wait-for-load` as a distinct state
 * (mapped to awaiting_carrier) but conflates out_for_delivery into
 * intransit. Goes intransit → in-final-destination → delivered (which we
 * map to `collected` since BoxNow is locker-only).
 */
const BOXNOW_TIMELINE: CarrierTimeline = {
  carrier: "box_now",
  stages: [
    ...PRE_SHIPMENT,
    { code: "label_created", isMain: true },
    { code: "awaiting_carrier", isMain: true },
    { code: "in_transit", isMain: true },
    // No out_for_delivery — BoxNow goes straight to arrived_at_pickup
    { code: "arrived_at_pickup", isMain: true },
    { code: "collected", isMain: true, terminal: true },
    // BoxNow exposes `lost` and `missing` as distinct states (mapped to lost)
    { code: "lost",      exception: true, terminal: true, branchesFrom: "in_transit" },
    { code: "returning", exception: true,                  branchesFrom: "arrived_at_pickup", rejoinsAt: "in_transit" },
    { code: "returned",  exception: true, terminal: true, branchesFrom: "arrived_at_pickup" },
    { code: "cancelled", exception: true, terminal: true, branchesFrom: "confirmed" },
  ],
};

/**
 * Geniki — supports home delivery, branch pickup, and 3rd-party lockers
 * (via the Vendor field). Has the richest delivery-attempt taxonomy:
 * absent / refused / wrong-address / damaged / rescheduled (the last maps
 * to on_hold). Also distinguishes out_for_delivery via C_A3.
 */
const GENIKI_TIMELINE: CarrierTimeline = {
  carrier: "geniki",
  stages: [
    ...PRE_SHIPMENT,
    { code: "label_created", isMain: true },
    { code: "in_transit", isMain: true },
    { code: "out_for_delivery", isMain: true },
    { code: "arrived_at_pickup", isMain: true },
    { code: "delivered", isMain: true, terminal: true },
    { code: "collected", isMain: true, terminal: true },
    // Exception branches — Geniki's full taxonomy
    { code: "delivery_attempted_absent",         exception: true, branchesFrom: "out_for_delivery", rejoinsAt: "out_for_delivery" },
    { code: "delivery_attempted_refused",        exception: true, branchesFrom: "out_for_delivery", rejoinsAt: "out_for_delivery" },
    { code: "delivery_attempted_wrong_address",  exception: true, branchesFrom: "out_for_delivery", rejoinsAt: "out_for_delivery" },
    { code: "delivery_attempted_damaged",        exception: true, branchesFrom: "out_for_delivery", rejoinsAt: "out_for_delivery" },
    { code: "on_hold",                           exception: true, branchesFrom: "in_transit",       rejoinsAt: "in_transit" },
    { code: "returning",                         exception: true, branchesFrom: "out_for_delivery", rejoinsAt: "out_for_delivery" },
    { code: "returned",   exception: true, terminal: true, branchesFrom: "out_for_delivery" },
    { code: "cancelled",  exception: true, terminal: true, branchesFrom: "confirmed" },
  ],
};

/**
 * ELTA — not yet API-integrated, but built-in. Use a generic timeline
 * that covers home + branch + locker; admin/customer experience matches
 * what a typical national post / courier would communicate.
 */
const ELTA_TIMELINE: CarrierTimeline = {
  carrier: "elta",
  stages: [
    ...PRE_SHIPMENT,
    { code: "label_created", isMain: true },
    { code: "in_transit", isMain: true },
    { code: "out_for_delivery", isMain: true },
    { code: "arrived_at_pickup", isMain: true },
    { code: "delivered", isMain: true, terminal: true },
    { code: "collected", isMain: true, terminal: true },
    { code: "delivery_attempted_absent",         exception: true, branchesFrom: "out_for_delivery", rejoinsAt: "out_for_delivery" },
    { code: "delivery_attempted_refused",        exception: true, branchesFrom: "out_for_delivery", rejoinsAt: "out_for_delivery" },
    { code: "delivery_attempted_wrong_address",  exception: true, branchesFrom: "out_for_delivery", rejoinsAt: "out_for_delivery" },
    { code: "on_hold",                           exception: true, branchesFrom: "in_transit",       rejoinsAt: "in_transit" },
    { code: "returning",                         exception: true, branchesFrom: "out_for_delivery", rejoinsAt: "out_for_delivery" },
    { code: "returned",   exception: true, terminal: true, branchesFrom: "out_for_delivery" },
    { code: "cancelled",  exception: true, terminal: true, branchesFrom: "confirmed" },
  ],
};

/**
 * Speedex — not yet API-integrated. Home + branch only; locker support
 * unknown until integration confirms.
 */
const SPEEDEX_TIMELINE: CarrierTimeline = {
  carrier: "speedex",
  stages: [
    ...PRE_SHIPMENT,
    { code: "label_created", isMain: true },
    { code: "in_transit", isMain: true },
    { code: "out_for_delivery", isMain: true },
    { code: "arrived_at_pickup", isMain: true },
    { code: "delivered", isMain: true, terminal: true },
    { code: "collected", isMain: true, terminal: true },
    { code: "delivery_attempted_absent",         exception: true, branchesFrom: "out_for_delivery", rejoinsAt: "out_for_delivery" },
    { code: "delivery_attempted_refused",        exception: true, branchesFrom: "out_for_delivery", rejoinsAt: "out_for_delivery" },
    { code: "delivery_attempted_wrong_address",  exception: true, branchesFrom: "out_for_delivery", rejoinsAt: "out_for_delivery" },
    { code: "returning",                         exception: true, branchesFrom: "out_for_delivery", rejoinsAt: "out_for_delivery" },
    { code: "returned",   exception: true, terminal: true, branchesFrom: "out_for_delivery" },
    { code: "cancelled",  exception: true, terminal: true, branchesFrom: "confirmed" },
  ],
};

/**
 * "Other" — catch-all built-in. Full spine; no exotic exception sub-codes
 * since we don't know what a generic non-integrated carrier supports.
 */
const OTHER_TIMELINE: CarrierTimeline = {
  carrier: "other",
  stages: [
    ...PRE_SHIPMENT,
    { code: "label_created", isMain: true },
    { code: "in_transit", isMain: true },
    { code: "out_for_delivery", isMain: true },
    { code: "arrived_at_pickup", isMain: true },
    { code: "delivered", isMain: true, terminal: true },
    { code: "collected", isMain: true, terminal: true },
    { code: "returning",  exception: true,                  branchesFrom: "out_for_delivery", rejoinsAt: "out_for_delivery" },
    { code: "returned",   exception: true, terminal: true, branchesFrom: "out_for_delivery" },
    { code: "cancelled",  exception: true, terminal: true, branchesFrom: "confirmed" },
  ],
};

// ---------------------------------------------------------------------------
// Generic / preset timelines
// ---------------------------------------------------------------------------

/**
 * The default timeline used by:
 *   - Custom carriers that don't override (preset=null)
 *   - Custom carriers that select preset='generic'
 *
 * Covers the full happy path + common exceptions. Sufficient for "we
 * deliver in our own van" workflows.
 */
const GENERIC_TIMELINE: CarrierTimeline = {
  carrier: "__generic__" as CarrierSlug,
  stages: [
    ...PRE_SHIPMENT,
    { code: "label_created", isMain: true },
    { code: "in_transit", isMain: true },
    { code: "out_for_delivery", isMain: true },
    { code: "delivered", isMain: true, terminal: true },
    { code: "delivery_attempted_absent", exception: true,                  branchesFrom: "out_for_delivery", rejoinsAt: "out_for_delivery" },
    { code: "cancelled",                 exception: true, terminal: true, branchesFrom: "confirmed" },
    { code: "returning",                 exception: true,                  branchesFrom: "out_for_delivery", rejoinsAt: "out_for_delivery" },
    { code: "returned",                  exception: true, terminal: true, branchesFrom: "out_for_delivery" },
  ],
};

// ---------------------------------------------------------------------------
// Registry + lookup helpers
// ---------------------------------------------------------------------------

const BUILT_IN_TIMELINES: Record<BuiltInCarrierSlug, CarrierTimeline> = {
  acs: ACS_TIMELINE,
  elta: ELTA_TIMELINE,
  box_now: BOXNOW_TIMELINE,
  speedex: SPEEDEX_TIMELINE,
  geniki: GENIKI_TIMELINE,
  other: OTHER_TIMELINE,
};

/**
 * Named presets that custom carriers can opt into via the admin form's
 * "Status timeline" dropdown. Each preset is a carrier-agnostic reuse of
 * one of the built-in timelines (without copying the slug).
 */
export const TIMELINE_PRESETS = {
  generic: GENERIC_TIMELINE,
  acs_style: { ...ACS_TIMELINE, carrier: "__preset_acs__" as CarrierSlug },
  geniki_style: { ...GENIKI_TIMELINE, carrier: "__preset_geniki__" as CarrierSlug },
  boxnow_style: { ...BOXNOW_TIMELINE, carrier: "__preset_boxnow__" as CarrierSlug },
} as const satisfies Record<string, CarrierTimeline>;

export type TimelinePresetName = keyof typeof TIMELINE_PRESETS;

/**
 * Resolves a carrier slug + optional preset name to a CarrierTimeline.
 *
 * Resolution order:
 *   1. Built-in carrier slug → its hardcoded timeline
 *   2. Custom carrier + preset name → preset timeline
 *   3. Custom carrier + no preset → generic timeline
 *   4. Unknown slug → generic timeline (fallback so the UI never breaks)
 *
 * Callers must pass `carrierSlug` (not just the row) so the function works
 * in both the customer-facing and admin paths.
 */
export function getTimelineForCarrier(
  carrierSlug: CarrierSlug | null,
  preset: TimelinePresetName | null = null
): CarrierTimeline {
  if (carrierSlug === null) return GENERIC_TIMELINE;
  if (carrierSlug in BUILT_IN_TIMELINES) {
    return BUILT_IN_TIMELINES[carrierSlug as BuiltInCarrierSlug];
  }
  if (preset && preset in TIMELINE_PRESETS) {
    return TIMELINE_PRESETS[preset];
  }
  return GENERIC_TIMELINE;
}

/**
 * Returns just the StatusCode list (in timeline order) for use in admin
 * status dropdowns and other "valid status options" UIs.
 */
export function getValidStatusesForCarrier(
  carrierSlug: CarrierSlug | null,
  preset: TimelinePresetName | null = null
): StatusCode[] {
  return getTimelineForCarrier(carrierSlug, preset).stages.map((s) => s.code);
}

/**
 * Returns only the main-spine stages — for the customer-facing progress
 * bar that hides exception branches until they actually occur.
 */
export function getMainStagesForCarrier(
  carrierSlug: CarrierSlug | null,
  preset: TimelinePresetName | null = null
): CarrierTimelineStage[] {
  return getTimelineForCarrier(carrierSlug, preset).stages.filter(
    (s) => s.isMain === true
  );
}

// ---------------------------------------------------------------------------
// Renderer helper — bucket a timeline into the shape OrderStatusTimeline
// consumes (main spine rows + per-row left/right exception branches).
//
// Convention enforced here:
//   - Recoverable exceptions (no `terminal` flag) sprout LEFT
//   - Terminal exceptions sprout RIGHT
// ---------------------------------------------------------------------------

export interface TimelineRow {
  main: CarrierTimelineStage;
  leftBranches: CarrierTimelineStage[];   // recoverable (loop back)
  rightBranches: CarrierTimelineStage[];  // terminal (no return)
}

/**
 * Buckets a carrier's timeline into per-main-stage rows with the
 * exception branches attached to the spine row they sprout from.
 * Exceptions without a `branchesFrom` (or whose target main stage isn't
 * in the carrier's spine) fall back to the LAST main stage so they're
 * visible rather than silently dropped.
 */
export function buildTimelineRows(timeline: CarrierTimeline): TimelineRow[] {
  const mainStages = timeline.stages.filter((s) => s.isMain === true);
  const exceptionStages = timeline.stages.filter((s) => s.exception === true);

  const rows: TimelineRow[] = mainStages.map((m) => ({
    main: m,
    leftBranches: [],
    rightBranches: [],
  }));
  const rowByCode = new Map<StatusCode, TimelineRow>();
  for (const r of rows) rowByCode.set(r.main.code, r);

  const fallbackRow = rows[rows.length - 1];

  for (const ex of exceptionStages) {
    const target = ex.branchesFrom ? rowByCode.get(ex.branchesFrom) : null;
    const row = target ?? fallbackRow;
    if (!row) continue;
    if (ex.terminal === true) {
      row.rightBranches.push(ex);
    } else {
      row.leftBranches.push(ex);
    }
  }

  return rows;
}

