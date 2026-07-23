import "server-only";
import type { Carrier } from "@/types/order-history";
import type { Capability } from "@/types/carrier-provider";

/**
 * Per-shipment input the price-calculation endpoint needs from the order
 * flow. Kept carrier-agnostic — each provider maps these into its native
 * field names. Phase 2 surfaces the interface; Phase 3 fills in callers.
 */
export interface PriceContext {
  /** Recipient postcode — every carrier prices by destination zone. */
  recipient_zipcode: string;
  /** Recipient country, two-letter ISO. Defaults to 'GR' inside providers. */
  recipient_country?: string;
  /** Sum of weights of all items, in kilograms. */
  weight_kg: number;
  /** Optional dimensions (cm) — drives volumetric weight pricing. */
  dimension_x_cm?: number;
  dimension_y_cm?: number;
  dimension_z_cm?: number;
  /** Number of physical packages (parcels). Defaults to 1. */
  item_quantity?: number;
  /**
   * COD amount in shop currency (EUR). Drives the COD handling fee. Omit /
   * 0 for prepaid orders.
   */
  cod_amount?: number;
  /**
   * Whether the recipient is an ACS station (drives pricing for
   * delivery_method='delivery_station_pickup' or 'carrier_pickup').
   */
  station_destination?: number | null;
  /**
   * Phase 5 — when true, the carrier should include the official remote-area
   * surcharge in the quote (e.g., ACS adds `REM` to Acs_Delivery_Products,
   * which returns an Extra_Service_Ammount populated with the surcharge).
   *
   * Computed by the caller as `is_inaccessible && apply_remote_surcharge`
   * capability is enabled. The provider only consumes the boolean; it does
   * not re-check the capability.
   */
  apply_remote_surcharge?: boolean;
}

/**
 * Shape of a price quote. `shipping` and `cod_handling` are the two main fee
 * lines the resolver compares against custom rules; `extras` carries any
 * carrier-specific add-ons (insurance, signature, remote-area surcharge) so
 * the audit trail in fees_breakdown.meta can faithfully reconstruct the
 * carrier's pricing decomposition.
 */
export interface PriceQuote {
  /** Net shipping line in EUR. */
  shipping: number;
  /** COD handling line in EUR. 0 when the order isn't COD. */
  cod_handling: number;
  /** Carrier-named extras (e.g., 'remote_area_surcharge', 'oversize'). */
  extras: Record<string, number>;
  /** Currency code the carrier responded with. Always 'EUR' for Greek carriers. */
  currency: string;
  /**
   * Raw provider response — kept opaque on purpose. Lives in
   * fees_breakdown[].meta for auditing without forcing every provider to
   * normalize to the same field set.
   */
  raw: unknown;
}

/**
 * Voucher creation context. Phase 8 wires this — Phase 2 stubbed.
 *
 * Pickup-related fields drive how the voucher is built:
 *   pickup_type = "branch"  → add REC to Acs_Delivery_Products, set destination
 *   pickup_type = "locker"  → add REC + ensure Recipient_Cellphone is set
 *   pickup_type = null      → standard home delivery
 */
export interface VoucherContext {
  order_id: string;
  order_number: string;
  recipient_name: string;
  recipient_address: string;
  recipient_address_number?: string;
  recipient_zipcode: string;
  recipient_region?: string;
  recipient_country?: string;
  recipient_phone?: string | null;
  /**
   * Recipient mobile. Mandatory for Smartpoint pickups (ACS rejects the
   * voucher otherwise — the locker code is SMS-delivered).
   */
  recipient_cellphone?: string | null;
  recipient_email?: string | null;
  weight_kg: number;
  item_quantity: number;
  cod_amount?: number;
  /** Phase 7 pickup point selection. Drives REC flag and station routing. */
  pickup_type?: "locker" | "branch" | null;
  pickup_station_id?: string | null;
  pickup_branch_id?: number | null;
  delivery_notes?: string | null;
}

export interface VoucherResult {
  voucher_number: string;
  tracking_url: string | null;
  label_url: string | null;
  raw: unknown;
}

/** Phase 8 — voucher cancellation. */
export interface CancelResult {
  ok: boolean;
  /** Greek-localized human-readable message; empty on success. */
  message?: string;
  raw?: unknown;
}

/** Phase 8b — batch finalization (ACS Issue_Pickup_List / Geniki ClosePendingJobs). */
export interface FinalizeBatchResult {
  ok: boolean;
  /** Carrier-issued batch ID when the operation succeeds (ACS pickup list no.). */
  batch_id?: string | null;
  /** Number of vouchers included in the batch. Carrier may not report this. */
  voucher_count?: number | null;
  /** Greek-localized human-readable message; empty on success. */
  message?: string;
  raw?: unknown;
}

/**
 * Tracking status — Phase 8 replaces the placeholder enum with our shared
 * StatusCode vocabulary (src/config/status-vocabulary.ts) so the carrier-
 * native code maps directly into the order's `status` column without a
 * second translation layer.
 *
 * `events` is the carrier's event stream verbatim — the admin order page
 * shows it as a sub-timeline beneath the unified status.
 */
export interface TrackingResult {
  /** Mapped StatusCode (from src/config/status-vocabulary). */
  status: import("@/config/status-vocabulary").StatusCode;
  /** Carrier's native status code, e.g. ACS shipment_status + sub-reason composite. */
  raw_status: string | null;
  /** Carrier's human-readable status label, in the carrier's language. */
  status_label: string | null;
  events: Array<{
    occurred_at: string;
    description: string;
    location?: string | null;
    raw_code?: string | null;
  }>;
  raw: unknown;
}

/**
 * Abstraction over a carrier's REST API. Phase 2 only requires
 * `testConnection`; the other methods are part of the contract so callers
 * can be type-safe across phases but implementations may `throw new Error("not implemented")`
 * until their phase lands.
 */
export interface CarrierProvider {
  readonly carrier: Carrier;
  /**
   * Cheap, idempotent call that proves credentials work — implementations
   * should pick a read-only endpoint (ACS uses ACS_Area_Find_By_Zip_Code or
   * ACS_Stations). Returns { ok: false, message } on failure so the admin
   * can see why the test fails without surfacing a 500 in the UI.
   */
  testConnection(): Promise<{ ok: boolean; message?: string }>;
  priceCalculate(ctx: PriceContext): Promise<PriceQuote>;
  createVoucher(ctx: VoucherContext): Promise<VoucherResult>;
  /** Phase 8 — voucher cancellation. */
  cancelVoucher(voucherNumber: string): Promise<CancelResult>;
  /**
   * Phase 8 — fetch tracking summary + checkpoint events for a voucher.
   * Used by both the admin order page (on-demand) and refreshTracking cron
   * (batch). The returned `status` is already mapped to our StatusCode
   * vocabulary; callers don't need a per-carrier translation table.
   */
  trackingSummary(trackingNumber: string): Promise<TrackingResult>;
  /**
   * Phase 8b — closes the daily batch. For ACS this calls
   * `ACS_Issue_Pickup_List`, which is mandatory before the carrier picks up
   * the vouchers. For Geniki this calls `ClosePendingJobs`. Carriers without
   * a batch-close concept (BoxNow) should return `{ ok: true }` with a
   * "no-op" message rather than throwing — the capability gate (off for
   * such carriers) prevents the call from happening in practice anyway.
   */
  finalizeBatch(): Promise<FinalizeBatchResult>;
  /**
   * Phase 4 — the upper bound of capabilities this provider class can
   * service. The admin can pick any subset to enable via the per-row
   * config, but cannot enable capabilities outside this set.
   *
   * Implementations should return the set of features they have actually
   * coded (not aspirational ones). When a capability is partially built —
   * for example `create_voucher` exists but `cancel_voucher` is still a
   * stub — only the working ones go in this set.
   */
  supportedCapabilities(): Set<Capability>;
}
