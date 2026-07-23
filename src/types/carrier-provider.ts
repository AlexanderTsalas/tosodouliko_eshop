import type { Carrier } from "./order-history";

// ---------------------------------------------------------------------------
// API capability granularity — Phase 4 of courier-integration-design.md
//
// Each carrier integration is a bundle of separable features. The admin
// chooses per-merchant which capabilities of an integration the app actively
// uses. A merchant who wants ACS for address validation only — keeping
// pricing on custom rules — turns on `address_validation` and leaves
// `fetch_price_quote` off. Runtime gates everywhere consult this set before
// calling the corresponding API.
//
// Capabilities form a dependency graph (e.g. surface_inaccessibility
// requires address_validation). The admin form enforces these — child
// capabilities auto-disable when their parent is off.
//
// Not every provider supports every capability. AcsProvider.supportedCapabilities()
// declares the upper bound for ACS; admin checkboxes are filtered to that set.
// BoxNow / Geniki / etc will declare their own sets when their providers ship.
// ---------------------------------------------------------------------------

export type Capability =
  /** Call zipcode→station lookup (and derive serviceability + remote flag). */
  | "address_validation"
  /** Show "remote area" banner to customer in checkout. Requires address_validation. */
  | "surface_inaccessibility"
  /** Call the carrier's pricing API at checkout / order placement. */
  | "fetch_price_quote"
  /** Add the REM-style surcharge to the quote when the postcode is remote. Requires fetch_price_quote. */
  | "apply_remote_surcharge"
  /** Populate the locker / Smart Point picker from the carrier's API. */
  | "list_smartpoints"
  /** Populate the branch picker from the carrier's API. */
  | "list_branches"
  /** Expose carrier's "any-locker / customer picks later" mode (BoxNow only). */
  | "defer_locker_selection"
  /** Generate the shipping voucher via the carrier's API. */
  | "create_voucher"
  /** Poll the carrier for status updates and auto-advance fulfillment_status. */
  | "fetch_tracking"
  /** Daily handoff close (ACS Issue_Pickup_List / Geniki ClosePendingJobs). */
  | "batch_finalize"
  /** Cancel a voucher via the carrier's API. */
  | "cancel_voucher"
  /** Persist api_quote on fee_breakdown for divergence reports. Requires fetch_price_quote. */
  | "store_api_quote_for_audit";

/**
 * Dependency graph: child capability → parent it requires. When parent is
 * off, child auto-disables (UI) and is treated as off (runtime), regardless
 * of what's in config.
 *
 * Used by getCapabilities() (server-side resolution) and the admin form
 * (UI auto-disable cascading).
 */
export const CAPABILITY_DEPENDS_ON: Partial<Record<Capability, Capability>> = {
  surface_inaccessibility: "address_validation",
  apply_remote_surcharge: "fetch_price_quote",
  store_api_quote_for_audit: "fetch_price_quote",
};

/**
 * Named presets the admin form exposes as one-click options.
 *
 *   full         — every supported capability ON. Default for fresh installs
 *                  that want the integration to "just work" end-to-end.
 *   validation   — pre-checkout validation + voucher/tracking; pricing OFF.
 *                  Merchant's custom rules drive shipping cost; ACS is used
 *                  only for serviceability and operations. This is the
 *                  "Merchant A" scenario from the design doc.
 *   manual       — credentials stored but nothing called automatically.
 *                  Equivalent to having no provider; useful when the admin
 *                  wants to keep credentials warm for occasional manual use.
 *   custom       — per-capability checkboxes; no preset.
 */
export type CapabilityPreset = "full" | "validation" | "manual" | "custom";

/**
 * Resolves a preset name to the capability subset it enables. Anything not
 * in the returned set is OFF. Intersected with the provider's
 * supportedCapabilities() at runtime — capabilities the provider can't do
 * are silently dropped.
 */
export const PRESET_CAPABILITIES: Record<Exclude<CapabilityPreset, "custom">, Capability[]> = {
  full: [
    "address_validation",
    "surface_inaccessibility",
    "fetch_price_quote",
    "apply_remote_surcharge",
    "list_smartpoints",
    "list_branches",
    "defer_locker_selection",
    "create_voucher",
    "fetch_tracking",
    "batch_finalize",
    "cancel_voucher",
    "store_api_quote_for_audit",
  ],
  validation: [
    "address_validation",
    "surface_inaccessibility",
    "list_smartpoints",
    "list_branches",
    "create_voucher",
    "fetch_tracking",
    "batch_finalize",
    "cancel_voucher",
  ],
  manual: [],
};

/**
 * Shape of the capabilities block inside carrier_provider_configs.config.
 * Partial because a row may omit it (legacy / new install) — in that case
 * getCapabilities() falls back to the 'full' preset.
 */
export type CapabilityConfig = Partial<Record<Capability, boolean>>;

/**
 * Persisted shape of a carrier integration configuration.
 *
 * Per-carrier the merchant can have at most one `is_active=true` row. The
 * order's `carrier` column still decides which provider to call at runtime
 * (per-order routing) — `is_active` exists so a misconfigured row can be
 * disabled without deleting historical credentials.
 *
 * `secrets_encrypted` is JSON-encoded carrier credentials sealed with
 * AES-256-GCM using CARRIER_SECRETS_KEY. Only ever decrypted server-side
 * inside the provider implementation.
 *
 * `config.capabilities` — per-capability toggles. See Capability
 * type. When absent, defaults to the 'full' preset intersected with the
 * provider's supportedCapabilities().
 *
 * `config.preset` — informational only. Records which preset the
 * admin most recently picked so the form can re-show it; runtime ignores
 * this and reads `config.capabilities` directly.
 */
export interface CarrierProviderConfig {
  id: string;
  carrier: Carrier;
  display_name: string;
  /** Non-secret carrier-specific settings; shape depends on `carrier`. */
  config: Record<string, unknown>;
  /**
   * Bytea round-trip: PostgREST renders as `\xHEX…` strings on read, accepts
   * Buffers or hex strings on write. Use bytesFromSupabase() before decrypting.
   */
  secrets_encrypted: string | null;
  is_active: boolean;
  last_test_at: string | null;
  last_test_status: string | null;
  last_test_message: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// ACS-specific shapes
// ---------------------------------------------------------------------------

/**
 * Non-secret ACS settings. The ACS endpoint receives these on every voucher
 * creation alongside the per-shipment payload, so they're stored centrally
 * and edited via /admin/settings/couriers rather than hard-coded.
 */
export interface AcsConfig {
  /**
   * Override only for staging/test environments. Defaults to
   * https://webservices.acscourier.net/ACSRestServices/api/ACSAutoRest
   */
  base_url?: string;
  /** Sender name written on every voucher. */
  sender_name: string;
  /** Merchant's ACS billing code, printed on each voucher. */
  billing_code: string;
  /**
   * ACS station code (Greek, uppercase, e.g., 'ΑΘ' for Athens) of the
   * merchant's pickup point. Required by ACS_Price_Calculation as the origin
   * of every quote. Find your code via the ACS dashboard or by calling
   * ACS_Area_Find_By_Zip_Code on the merchant warehouse's zipcode.
   */
  origin_station: string;
  /**
   * 0 = recipient pays, 1 = pre-paid, 2 = sender pays (this is the merchant).
   * ACS's `Charge_Type` field. Defaults to 2.
   */
  default_charge_type?: 0 | 1 | 2;
  /** Voucher language for tracking pages/labels. ACS supports 'EN' and 'GR'. */
  language?: "EN" | "GR";
  /**
   * Phase 4 — per-capability toggles. When absent, getCapabilities() falls
   * back to the 'full' preset intersected with AcsProvider's
   * supportedCapabilities().
   */
  capabilities?: CapabilityConfig;
  /**
   * Phase 4 — informational record of which preset the admin most recently
   * applied. Runtime ignores this and reads `capabilities` directly.
   */
  preset?: CapabilityPreset;
}

/**
 * The five secrets ACS requires on every request. AcsApiKey goes in the
 * header; the four Company/User fields go in ACSInputParameters.
 */
export interface AcsSecrets {
  api_key: string;
  company_id: string;
  company_password: string;
  user_id: string;
  user_password: string;
}

// ---------------------------------------------------------------------------
// BoxNow-specific shapes
// ---------------------------------------------------------------------------

/**
 * Non-secret BoxNow settings. BoxNow uses OAuth client_credentials — the
 * client ID is non-secret (it's effectively a username), and the client
 * secret is in BoxNowSecrets.
 *
 * BoxNow API has separate Stage (sandbox) and Production base URLs:
 *   - Stage:      https://stage-api.boxnow.gr
 *   - Production: https://production-api.boxnow.gr
 *
 * NOTE on field shapes: the BoxNow public API surface evolves; the field
 * names below match the most common public-docs shape but the merchant
 * MAY need to adjust if their account uses a different version. Verify
 * against the sandbox before shipping to production.
 */
export interface BoxNowConfig {
  /** Override; defaults to production. Set to stage URL for sandbox testing. */
  base_url?: string;
  /**
   * BoxNow merchant ID (a.k.a. "partnerId" in some docs). Sent on every
   * delivery-requests call as the originating partner.
   */
  partner_id: string;
  /**
   * BoxNow origin location ID — the merchant's own drop-off APM or warehouse
   * (returned by /origins). Required on createVoucher as the parcel's pickup
   * point. Resolved once via the BoxNow dashboard or /origins endpoint and
   * stored here.
   */
  origin_location_id: string;
  /**
   * Default parcel size (1=small, 2=medium, 3=large). The cart-to-size
   * helper can override this per-order based on item weights; this default
   * applies when the cart's dimensions can't be inferred (e.g. items
   * without weight_kg).
   */
  default_parcel_size?: 1 | 2 | 3;
  /** Phase 4 — per-capability toggles. See AcsConfig for semantics. */
  capabilities?: CapabilityConfig;
  /** Phase 4 — informational preset record. */
  preset?: CapabilityPreset;
}

/**
 * BoxNow OAuth credentials. clientId is the public-ish identifier; secret
 * is the password. Both are issued via the BoxNow merchant dashboard.
 */
export interface BoxNowSecrets {
  client_id: string;
  client_secret: string;
}

// ---------------------------------------------------------------------------
// Geniki-specific shapes
// ---------------------------------------------------------------------------

/**
 * Non-secret Geniki Taxydromiki settings. The SOAP endpoints take a
 * username/password pair (in GenikiSecrets) and short-lived session
 * authKey returned by Authenticate; everything below is per-merchant
 * configuration sent on every CreateJob call.
 *
 * Default endpoint:
 *   - Production: https://services.taxydromiki.com/web2/web2.asmx
 *
 * Geniki SOAP responses use a `Result` integer code where:
 *   - 0  = success
 *   - 11 = expired/invalid authKey (refresh and retry)
 *   - other non-zero = errors with ErrorDescription text
 */
export interface GenikiConfig {
  /** Override only for staging/test. Defaults to production SOAP endpoint. */
  base_url?: string;
  /** Greek-language voucher language code, e.g. 'GR'. Defaults to 'GR'. */
  language?: "GR" | "EN";
  /** Phase 4 — per-capability toggles. See AcsConfig for semantics. */
  capabilities?: CapabilityConfig;
  /** Phase 4 — informational preset record. */
  preset?: CapabilityPreset;
}

/**
 * Geniki SOAP credentials. Username + password are issued via the Geniki
 * merchant portal. Exchanged for a short-lived authKey via the
 * Authenticate operation; the authKey is cached in-process by the provider.
 */
export interface GenikiSecrets {
  username: string;
  password: string;
}

/**
 * Discriminated-union place-holder for forthcoming carriers. Phase 2 only
 * ships ACS; Phase 11 adds BoxNow; Phase 12 adds Geniki; ELTA/SpeedEx land
 * in later phases.
 */
export type CarrierSecrets =
  | ({ carrier: "acs" } & AcsSecrets)
  | ({ carrier: "box_now" } & BoxNowSecrets)
  | ({ carrier: "geniki" } & GenikiSecrets)
  | { carrier: Exclude<Carrier, "acs" | "box_now" | "geniki">; [key: string]: unknown };
