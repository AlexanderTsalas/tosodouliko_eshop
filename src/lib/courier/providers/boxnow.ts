import "server-only";
import type {
  BoxNowConfig,
  BoxNowSecrets,
  Capability,
} from "@/types/carrier-provider";
import type {
  CancelResult,
  CarrierProvider,
  FinalizeBatchResult,
  PriceContext,
  PriceQuote,
  TrackingResult,
  VoucherContext,
  VoucherResult,
} from "../provider";
import type { StatusCode } from "@/config/status-vocabulary";
import { mapCartToBoxNowSize, type BoxNowParcelSize } from "../boxNowSize";

const DEFAULT_BASE_URL = "https://production-api.boxnow.gr";

/**
 * BoxNow API integration.
 *
 * BoxNow uses OAuth client_credentials. Token is fetched on demand and
 * cached in-process for the response's `expires_in` window (typically
 * ~1 hour) minus 60s of safety margin. On 401 the next call refreshes
 * automatically — a process restart loses the cache, which costs one
 * extra auth round-trip per cold process, well within rate limits.
 *
 * IMPORTANT — endpoint shapes verified against the latest publicly
 * documented BoxNow API. The merchant SHOULD test against the sandbox
 * before going live; any field-name divergence shows up immediately as
 * a 4xx with a clear error message which surfaces in the admin order
 * page's "Δημιουργία voucher" failure path.
 *
 * Endpoints used (rooted at base_url):
 *   POST /api/v1/auth-sessions            — OAuth token (one-shot)
 *   GET  /api/v1/lockers                  — locker listing (cached)
 *   POST /api/v1/delivery-requests        — create parcel
 *   GET  /api/v1/parcels/{id}             — tracking
 *   POST /api/v1/parcels/{id}:cancel      — cancel
 *   GET  /api/v1/parcels/{id}/label.pdf   — label fetch (lazy, on demand)
 *
 * Special locationId values:
 *   - locationId=2 ("any-apm" / "deferred selection") — customer picks the
 *     locker after dispatch. Wired behind the defer_locker_selection
 *     capability so the merchant can opt in.
 */
export class BoxNowProvider implements CarrierProvider {
  readonly carrier = "box_now" as const;

  /**
   * In-process OAuth token cache. Keyed by client_id so multiple
   * carrier_provider_configs rows for distinct BoxNow tenants don't
   * collide. Static so it survives across provider instantiations within
   * the same process (every quote/voucher call constructs a fresh provider).
   */
  private static tokenCache = new Map<
    string,
    { token: string; expiresAt: number }
  >();

  constructor(
    private readonly config: BoxNowConfig,
    private readonly secrets: BoxNowSecrets
  ) {}

  /**
   * Phase 11 — capabilities BoxNow can service. The notable difference from
   * ACS:
   *
   *   - No `apply_remote_surcharge` — BoxNow flat rates regardless of zip
   *   - No `list_branches`          — BoxNow has lockers only
   *   - No `batch_finalize`         — BoxNow auto-dispatches; no daily close
   *   - YES `defer_locker_selection` — BoxNow's "any-apm" flow
   *
   * `fetch_price_quote` is OFF by default in many BoxNow contracts (which
   * are flat-rate / pre-negotiated) but the API does support pricing
   * queries; left in supported set so admins can opt in. Resolver's
   * custom rules still drive cost when this is off.
   */
  supportedCapabilities(): Set<Capability> {
    return new Set<Capability>([
      "address_validation",
      "fetch_price_quote",
      "list_smartpoints",
      "defer_locker_selection",
      "store_api_quote_for_audit",
      "create_voucher",
      "cancel_voucher",
      "fetch_tracking",
    ]);
  }

  /**
   * Cheap health check — exchanges credentials for a token. If auth
   * succeeds, the credentials are valid; we don't need a second probe.
   */
  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    try {
      await this.token();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  /**
   * BoxNow uses /lockers (not /destinations as some older docs name it)
   * for the consumer locker list. Returns the full active set; caller
   * (refreshDirectories) handles cache writes.
   */
  async listLockers(country: string = "GR"): Promise<BoxNowLocker[]> {
    const res = await this.call<{ data?: BoxNowLockerApiRow[] }>(
      "GET",
      `/api/v1/lockers?countryCode=${encodeURIComponent(country)}&status=ENABLED`
    );
    const rows = res.data ?? [];
    return rows.map((r) => ({
      locker_id: String(r.id),
      name: r.name ?? "",
      address: r.addressLine1 ?? null,
      zipcode: r.postalCode ?? null,
      area: r.city ?? null,
      lat: typeof r.latitude === "number" ? r.latitude : null,
      lng: typeof r.longitude === "number" ? r.longitude : null,
      raw: r as unknown as Record<string, unknown>,
    }));
  }

  /**
   * BoxNow's price-quote endpoint (when a merchant has variable pricing).
   * Many contracts are flat-rate per parcel size, in which case the
   * resolver's custom rules handle costing and this method isn't
   * reached. Capability-gated.
   */
  async priceCalculate(ctx: PriceContext): Promise<PriceQuote> {
    const size = mapCartToBoxNowSize(ctx.weight_kg ?? 0);
    const body = {
      partnerId: this.config.partner_id,
      parcelSize: size,
      // BoxNow's pricing endpoint may take fewer fields than this; the
      // unused ones are silently ignored by the API.
      destinationCountry: ctx.recipient_country ?? "GR",
      destinationPostalCode: ctx.recipient_zipcode,
      codAmount: ctx.cod_amount ?? 0,
    };

    const res = await this.call<BoxNowPriceResponse>(
      "POST",
      "/api/v1/price-quotes",
      body
    );

    const shipping = Number(res.shippingPrice ?? 0);
    const codHandling = Number(res.codFee ?? 0);

    return {
      shipping,
      cod_handling: codHandling,
      extras: {},
      currency: res.currency ?? "EUR",
      raw: res,
    };
  }

  /**
   * Creates a delivery request (BoxNow's term for "voucher"). Returns the
   * parcel ID, which becomes the order's tracking_number. Caller is
   * responsible for idempotency.
   *
   * `pickup_station_id` semantics:
   *   - regular locker UUID → destination is that locker
   *   - "deferred" (string)  → locationId=2 in the API; customer chooses
   *                            later via the BoxNow consumer flow. Requires
   *                            defer_locker_selection capability.
   *
   * Customer mobile phone is MANDATORY — BoxNow SMSes the locker code to
   * the recipient. Same constraint as ACS Smartpoint pickups.
   */
  async createVoucher(ctx: VoucherContext): Promise<VoucherResult> {
    if (!ctx.recipient_cellphone?.trim()) {
      throw new Error(
        "BoxNow requires a recipient mobile phone (locker code is SMS-delivered)."
      );
    }
    if (!ctx.pickup_station_id) {
      throw new Error("BoxNow voucher missing destination locker (pickup_station_id).");
    }

    // 'deferred' sentinel → BoxNow's "any APM" mode. Customer picks the
    // specific locker later via the BoxNow consumer app/SMS link.
    const destinationLocationId =
      ctx.pickup_station_id === "deferred" ? "2" : ctx.pickup_station_id;

    const size = mapCartToBoxNowSize(ctx.weight_kg ?? 0);
    const isCod = (ctx.cod_amount ?? 0) > 0;

    const body: BoxNowCreateRequest = {
      partnerId: this.config.partner_id,
      orderId: ctx.order_number,
      // Origin is the merchant's BoxNow drop-off locker, configured once
      // in CarrierProviderForm and reused across every parcel.
      originLocationId: this.config.origin_location_id,
      destinationLocationId,
      parcelSize: size,
      cod: isCod
        ? { amount: ctx.cod_amount ?? 0, currency: "EUR" }
        : undefined,
      recipient: {
        firstName: splitName(ctx.recipient_name).first,
        lastName: splitName(ctx.recipient_name).last,
        phoneNumber: ctx.recipient_cellphone,
        email: ctx.recipient_email ?? undefined,
      },
      addresses: ctx.recipient_address
        ? {
            street: ctx.recipient_address,
            streetNumber: ctx.recipient_address_number ?? undefined,
            postalCode: ctx.recipient_zipcode,
            city: ctx.recipient_region ?? undefined,
            country: ctx.recipient_country ?? "GR",
          }
        : undefined,
      note: ctx.delivery_notes ?? undefined,
    };

    const res = await this.call<BoxNowCreateResponse>(
      "POST",
      "/api/v1/delivery-requests",
      body
    );

    const parcelId = res.data?.id ?? res.id ?? null;
    if (!parcelId) {
      throw new Error("BoxNow returned no parcel ID.");
    }

    return {
      voucher_number: String(parcelId),
      // BoxNow exposes a tracking page at boxnow.gr/parcels/{id}; we leave
      // null here and let delivery_carriers.tracking_url_template build
      // the customer-facing URL via buildTrackingUrl.
      tracking_url: null,
      label_url: null,
      raw: res,
    };
  }

  /**
   * Cancels a delivery request before BoxNow picks it up. Once the parcel
   * is in transit BoxNow refuses cancellation and returns an error which
   * we surface verbatim.
   */
  async cancelVoucher(voucherNumber: string): Promise<CancelResult> {
    if (!voucherNumber.trim()) {
      return { ok: false, message: "Λείπει ο αριθμός voucher." };
    }
    try {
      const res = await this.call<unknown>(
        "POST",
        `/api/v1/parcels/${encodeURIComponent(voucherNumber.trim())}:cancel`
      );
      return { ok: true, raw: res };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  /**
   * Fetches the current parcel state. BoxNow returns a single status
   * string (no separate event stream in v1); we expose it via `events`
   * with one entry so the admin order page renders consistently with
   * ACS's multi-event flow.
   */
  async trackingSummary(trackingNumber: string): Promise<TrackingResult> {
    const res = await this.call<BoxNowParcelResponse>(
      "GET",
      `/api/v1/parcels/${encodeURIComponent(trackingNumber)}`
    );
    const parcel = res.data ?? res;
    const rawState = parcel.state ?? parcel.status ?? null;
    const stateLabel = parcel.statusDescription ?? rawState ?? null;
    const updatedAt = parcel.updatedAt ?? parcel.lastUpdatedAt ?? null;

    return {
      status: mapBoxNowState(rawState),
      raw_status: rawState,
      status_label: stateLabel,
      events: rawState
        ? [
            {
              occurred_at: updatedAt ?? new Date().toISOString(),
              description: stateLabel ?? rawState,
              location: null,
              raw_code: rawState,
            },
          ]
        : [],
      raw: res,
    };
  }

  /**
   * BoxNow auto-dispatches — no daily batch-close concept. The capability
   * gate (off for BoxNow rows) prevents the daily handoff page from
   * surfacing BoxNow at all; this implementation is a defensive no-op for
   * the case where the gate is bypassed.
   */
  async finalizeBatch(): Promise<FinalizeBatchResult> {
    return {
      ok: true,
      batch_id: null,
      voucher_count: null,
      message: "BoxNow auto-dispatches; no manual batch close.",
    };
  }

  // ---------------------------------------------------------------------------
  // OAuth + low-level HTTP wrapper
  // ---------------------------------------------------------------------------

  /**
   * Returns a cached or freshly minted access token. Cache TTL respects
   * the server's `expires_in` minus a 60-second safety margin so a request
   * mid-flight doesn't 401.
   */
  private async token(): Promise<string> {
    const cached = BoxNowProvider.tokenCache.get(this.secrets.client_id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    const url = `${this.config.base_url || DEFAULT_BASE_URL}/api/v1/auth-sessions`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grantType: "client_credentials",
          clientId: this.secrets.client_id,
          clientSecret: this.secrets.client_secret,
        }),
        signal: AbortSignal.timeout(15_000),
        // Explicit no-store — auth tokens shouldn't be cached by Next's
        // fetch layer; we have our own in-memory token cache above
        // (BoxNowProvider.tokenCache) with proper TTL handling.
        cache: "no-store",
      });
    } catch (e) {
      throw new Error(`BoxNow auth request failed: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(
        `BoxNow auth responded ${res.status}: ${text || res.statusText}`
      );
    }
    const json = (await res.json()) as BoxNowAuthResponse;
    const accessToken = json.access_token ?? json.accessToken;
    if (!accessToken) {
      throw new Error("BoxNow auth response missing access token.");
    }
    const expiresIn = Number(json.expires_in ?? json.expiresIn ?? 3600);
    BoxNowProvider.tokenCache.set(this.secrets.client_id, {
      token: accessToken,
      expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
    });
    return accessToken;
  }

  /**
   * One HTTP wrapper for every BoxNow call. Handles token refresh on
   * single 401 retry; throws on any other non-2xx with the server's
   * error message attached so the admin sees actionable feedback.
   */
  private async call<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<T> {
    const base = this.config.base_url || DEFAULT_BASE_URL;
    const url = `${base}${path}`;

    const doRequest = async (token: string): Promise<Response> => {
      return fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
        // Explicit no-store — courier API responses (locker listings,
        // shipment status) must never be cached by Next's fetch layer.
        // Per-request freshness is the correctness contract.
        cache: "no-store",
      });
    };

    let token = await this.token();
    let res: Response;
    try {
      res = await doRequest(token);
    } catch (e) {
      throw new Error(`BoxNow request failed: ${(e as Error).message}`);
    }
    if (res.status === 401) {
      // Token may have rotated server-side; drop cache and retry once.
      BoxNowProvider.tokenCache.delete(this.secrets.client_id);
      token = await this.token();
      res = await doRequest(token);
    }
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`BoxNow ${method} ${path} → ${res.status}: ${text || res.statusText}`);
    }
    return (await res.json()) as T;
  }
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

/**
 * Maps a BoxNow `state` / `status` string to our shared StatusCode
 * vocabulary. BoxNow's state names match their public docs; if a
 * merchant's contract uses a different vocabulary, this map needs to
 * extend. Unknown states default to `in_transit` so the order isn't
 * stuck — better to be optimistic than block.
 *
 * Notable: `DELIVERED_TO_BOX` means the parcel arrived at the recipient's
 * chosen locker, NOT that the customer has collected it. The recipient
 * picks it up via the BoxNow app/SMS-code flow, at which point the state
 * advances to `DELIVERED_TO_RECIPIENT` → `collected`.
 */
export function mapBoxNowState(state: string | null): StatusCode {
  if (!state) return "in_transit";
  const s = state.toUpperCase();
  switch (s) {
    case "LABEL_CREATED":
    case "CREATED":
      return "label_created";
    case "AT_DROP_OFF_POINT":
    case "HANDED_TO_PARTNER":
    case "PICKED_UP_FROM_PARTNER":
      return "awaiting_carrier";
    case "HANDED_TO_RIDER":
    case "IN_TRANSIT":
      return "in_transit";
    case "ON_DELIVERY":
    case "OUT_FOR_DELIVERY":
      return "out_for_delivery";
    case "DELIVERED_TO_BOX":
    case "AT_LOCKER":
    case "ARRIVED_AT_LOCKER":
      return "arrived_at_pickup";
    case "DELIVERED_TO_RECIPIENT":
    case "PICKED_UP_BY_RECIPIENT":
    case "DELIVERED":
      return "collected";
    case "RETURN_TO_SENDER":
    case "RETURNED":
      return "returned";
    case "CANCELED":
    case "CANCELLED":
      return "cancelled";
    case "DELIVERY_FAILED":
    case "FAILED":
      return "on_hold";
    default:
      return "in_transit";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * BoxNow's recipient block uses firstName/lastName separately. Greek
 * names are often single-token; we treat the last token as the surname
 * and the rest as first name. When only one token exists, last=first.
 */
function splitName(full: string): { first: string; last: string } {
  const trimmed = full.trim();
  if (!trimmed) return { first: "", last: "" };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return { first: parts[0], last: parts[0] };
  }
  const last = parts[parts.length - 1];
  const first = parts.slice(0, -1).join(" ");
  return { first, last };
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Wire-format types (verified against the public docs at time of writing;
// adjust if the merchant's contract uses a different field shape)
// ---------------------------------------------------------------------------

interface BoxNowAuthResponse {
  access_token?: string;
  accessToken?: string;
  expires_in?: number;
  expiresIn?: number;
  token_type?: string;
}

interface BoxNowLockerApiRow {
  id: string | number;
  name?: string;
  addressLine1?: string;
  postalCode?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  status?: string;
}

/** Normalized locker shape returned by listLockers. */
export interface BoxNowLocker {
  locker_id: string;
  name: string;
  address: string | null;
  zipcode: string | null;
  area: string | null;
  lat: number | null;
  lng: number | null;
  raw: Record<string, unknown>;
}

interface BoxNowCreateRequest {
  partnerId: string;
  orderId: string;
  originLocationId: string;
  destinationLocationId: string;
  parcelSize: BoxNowParcelSize;
  cod?: { amount: number; currency: string };
  recipient: {
    firstName: string;
    lastName: string;
    phoneNumber: string;
    email?: string;
  };
  addresses?: {
    street: string;
    streetNumber?: string;
    postalCode: string;
    city?: string;
    country: string;
  };
  note?: string;
}

interface BoxNowCreateResponse {
  data?: { id: string | number };
  id?: string | number;
}

interface BoxNowParcelResponse {
  data?: BoxNowParcelBody;
  state?: string;
  status?: string;
  statusDescription?: string;
  updatedAt?: string;
  lastUpdatedAt?: string;
}

interface BoxNowParcelBody {
  state?: string;
  status?: string;
  statusDescription?: string;
  updatedAt?: string;
  lastUpdatedAt?: string;
}

interface BoxNowPriceResponse {
  shippingPrice?: number;
  codFee?: number;
  currency?: string;
}
