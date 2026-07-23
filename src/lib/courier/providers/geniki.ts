import "server-only";
import type {
  Capability,
  GenikiConfig,
  GenikiSecrets,
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
import { genikiServiceCodeFor } from "../genikiServiceCode";

const DEFAULT_BASE_URL = "https://services.taxydromiki.com/web2/web2.asmx";
const SOAP_NAMESPACE = "http://taxydromiki.gr/Web2";

/**
 * Geniki Taxydromiki SOAP integration.
 *
 * Hand-rolled SOAP-over-HTTP — envelopes built as template strings, response
 * fields extracted via small targeted regexes scoped to the specific
 * `<Tag>value</Tag>` pairs we care about. Geniki's response shapes are flat
 * enough that this beats pulling in a full XML parser for the surface we
 * exercise.
 *
 * IMPORTANT — endpoint paths, namespace, and field names match the most
 * commonly documented Geniki SOAP API. The merchant SHOULD verify against
 * the actual WSDL (https://services.taxydromiki.com/web2/web2.asmx?WSDL)
 * before going live; any divergence shows up immediately as a SOAP Fault
 * or an unparsed-response error surfaced in the admin UI.
 *
 * SOAP operations used:
 *   Authenticate         — exchange username/password for authKey
 *   GetShopsList         — list Geniki branches
 *   GetLockersList       — list Geniki lockers
 *   CreateJob            — create voucher
 *   CancelJob            — cancel voucher
 *   ClosePendingJobs     — daily batch close (Phase 8b parallel)
 *   TrackAndTrace        — fetch tracking events
 *   GetVouchersPdf       — fetch printable label (deferred — surface
 *                          when admin label-print UI lands)
 *
 * authKey lifecycle:
 *   - Cached in-process per username for the response's TTL (Geniki
 *     typically returns ~30 minutes).
 *   - On `Result=11` from any call, drop the cache and re-Authenticate
 *     before retrying once.
 */
export class GenikiProvider implements CarrierProvider {
  readonly carrier = "geniki" as const;

  /**
   * In-process auth key cache. Keyed by username so multiple configured
   * Geniki tenants don't collide.
   */
  private static authCache = new Map<
    string,
    { authKey: string; expiresAt: number }
  >();

  constructor(
    private readonly config: GenikiConfig,
    private readonly secrets: GenikiSecrets
  ) {}

  /**
   * Phase 12 — capabilities Geniki can service. Notable differences from
   * ACS/BoxNow:
   *
   *   - YES batch_finalize  — ClosePendingJobs is Geniki's daily-close
   *                           call, equivalent to ACS Issue_Pickup_List
   *   - YES list_branches   — Geniki has retail shops
   *   - YES list_smartpoints — Geniki has lockers
   *   - NO  defer_locker_selection — Geniki has no "any-locker" mode
   *
   * fetch_price_quote is included only if the merchant's contract exposes
   * pricing via SOAP; many Geniki contracts are flat-rate negotiated, in
   * which case the admin leaves the capability off and resolver custom
   * rules drive cost.
   */
  supportedCapabilities(): Set<Capability> {
    return new Set<Capability>([
      "address_validation",
      "list_smartpoints",
      "list_branches",
      "store_api_quote_for_audit",
      "create_voucher",
      "cancel_voucher",
      "fetch_tracking",
      "batch_finalize",
    ]);
  }

  /**
   * Cheap health check — exchanges credentials for an authKey. If auth
   * succeeds, the credentials are valid.
   */
  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    try {
      await this.authKey();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  // ---------------------------------------------------------------------------
  // Directory listings
  // ---------------------------------------------------------------------------

  async listShops(): Promise<GenikiLocation[]> {
    const body = `<Authentication>${escapeXml(await this.authKey())}</Authentication>`;
    const xml = await this.soap("GetShopsList", body);
    return parseLocations(xml, "ShopInfo");
  }

  async listLockers(): Promise<GenikiLocation[]> {
    const body = `<Authentication>${escapeXml(await this.authKey())}</Authentication>`;
    const xml = await this.soap("GetLockersList", body);
    return parseLocations(xml, "LockerInfo");
  }

  // ---------------------------------------------------------------------------
  // Pricing (optional — many Geniki contracts are flat-rate negotiated)
  // ---------------------------------------------------------------------------

  async priceCalculate(_ctx: PriceContext): Promise<PriceQuote> {
    // Most Geniki contracts don't expose a SOAP pricing endpoint; pricing
    // is negotiated and printed on the contract. Returning a zero quote
    // here would mislead the resolver into thinking shipping is free, so
    // we throw — the capability gate (default off for Geniki) prevents
    // this from being called in the normal flow. If a future contract
    // surfaces pricing via SOAP, replace this with the real call.
    throw new Error(
      "Geniki SOAP pricing is contract-specific and not wired. Configure shipping cost via custom rules instead."
    );
  }

  // ---------------------------------------------------------------------------
  // Voucher lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Creates a Geniki voucher (CreateJob). Returns the voucher number, which
   * becomes the order's tracking_number. Caller handles idempotency.
   *
   * Service type derives from pickup_type + isCod via genikiServiceCodeFor:
   *   ΑΠ — home delivery (default)
   *   ΒΡ — branch reception
   *   ΑΡ — branch reception + COD
   *   ΛΟ — locker delivery
   */
  async createVoucher(ctx: VoucherContext): Promise<VoucherResult> {
    const country = (ctx.recipient_country ?? "GR").toUpperCase();
    const serviceCode = genikiServiceCodeFor(ctx);
    const isCod = (ctx.cod_amount ?? 0) > 0;
    const isPickup = ctx.pickup_type === "branch" || ctx.pickup_type === "locker";

    if (isPickup && !ctx.pickup_station_id) {
      throw new Error("Geniki voucher missing pickup_station_id.");
    }
    if (ctx.pickup_type === "locker" && !ctx.recipient_cellphone?.trim()) {
      throw new Error(
        "Geniki locker delivery requires a recipient mobile phone (the locker code is SMS-delivered)."
      );
    }

    const body = `
      <Authentication>${escapeXml(await this.authKey())}</Authentication>
      <Job>
        <ServiceType>${escapeXml(serviceCode)}</ServiceType>
        <RecipientName>${escapeXml(ctx.recipient_name)}</RecipientName>
        <RecipientAddress>${escapeXml(ctx.recipient_address)}</RecipientAddress>
        <RecipientAddressNumber>${escapeXml(ctx.recipient_address_number ?? "")}</RecipientAddressNumber>
        <RecipientZipCode>${escapeXml(ctx.recipient_zipcode)}</RecipientZipCode>
        <RecipientRegion>${escapeXml(ctx.recipient_region ?? "")}</RecipientRegion>
        <RecipientCountry>${escapeXml(country)}</RecipientCountry>
        <RecipientPhone>${escapeXml(ctx.recipient_phone ?? "")}</RecipientPhone>
        <RecipientMobile>${escapeXml(ctx.recipient_cellphone ?? "")}</RecipientMobile>
        <RecipientEmail>${escapeXml(ctx.recipient_email ?? "")}</RecipientEmail>
        <Weight>${escapeXml((ctx.weight_kg ?? 0).toFixed(2))}</Weight>
        <ItemQuantity>${escapeXml(String(ctx.item_quantity))}</ItemQuantity>
        <CodAmount>${escapeXml(isCod ? String(ctx.cod_amount ?? 0) : "0")}</CodAmount>
        <OrderRef>${escapeXml(ctx.order_number)}</OrderRef>
        <DeliveryNotes>${escapeXml(ctx.delivery_notes ?? "")}</DeliveryNotes>
        ${
          isPickup
            ? `<PickupLocationId>${escapeXml(ctx.pickup_station_id ?? "")}</PickupLocationId>`
            : ""
        }
      </Job>`;

    const xml = await this.soap("CreateJob", body);
    const result = extractInt(xml, "Result");
    if (result !== 0) {
      throw new Error(
        formatGenikiError("CreateJob", result, extractString(xml, "ErrorDescription"))
      );
    }
    const voucher = extractString(xml, "Voucher") || extractString(xml, "VoucherNumber");
    if (!voucher) {
      throw new Error("Geniki CreateJob returned no voucher number.");
    }

    return {
      voucher_number: voucher,
      tracking_url: null,
      label_url: null,
      raw: { result, xml: truncate(xml, 2000) },
    };
  }

  async cancelVoucher(voucherNumber: string): Promise<CancelResult> {
    if (!voucherNumber.trim()) {
      return { ok: false, message: "Λείπει ο αριθμός voucher." };
    }
    try {
      const body = `
        <Authentication>${escapeXml(await this.authKey())}</Authentication>
        <Voucher>${escapeXml(voucherNumber.trim())}</Voucher>`;
      const xml = await this.soap("CancelJob", body);
      const result = extractInt(xml, "Result");
      if (result !== 0) {
        return {
          ok: false,
          message: formatGenikiError(
            "CancelJob",
            result,
            extractString(xml, "ErrorDescription")
          ),
        };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  /**
   * Geniki's equivalent of ACS's Issue_Pickup_List — closes the day's
   * pending vouchers. After ClosePendingJobs, the included vouchers can
   * no longer be cancelled via the API.
   */
  async finalizeBatch(): Promise<FinalizeBatchResult> {
    try {
      const body = `<Authentication>${escapeXml(await this.authKey())}</Authentication>`;
      const xml = await this.soap("ClosePendingJobs", body);
      const result = extractInt(xml, "Result");
      if (result !== 0) {
        return {
          ok: false,
          message: formatGenikiError(
            "ClosePendingJobs",
            result,
            extractString(xml, "ErrorDescription")
          ),
        };
      }
      const batchId = extractString(xml, "BatchId") || extractString(xml, "ClosingId") || null;
      const count = extractInt(xml, "VoucherCount");
      return {
        ok: true,
        batch_id: batchId,
        voucher_count: Number.isFinite(count) ? count : null,
      };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  /**
   * Fetches checkpoint events for a voucher via TrackAndTrace. Geniki
   * returns a list of `<Checkpoint>` rows; we map the latest one's status
   * code to our shared StatusCode vocabulary and expose all events as
   * the event stream for the admin order page's sub-timeline.
   */
  async trackingSummary(trackingNumber: string): Promise<TrackingResult> {
    const body = `
      <Authentication>${escapeXml(await this.authKey())}</Authentication>
      <Voucher>${escapeXml(trackingNumber)}</Voucher>`;
    const xml = await this.soap("TrackAndTrace", body);
    const result = extractInt(xml, "Result");
    if (result !== 0) {
      throw new Error(
        formatGenikiError("TrackAndTrace", result, extractString(xml, "ErrorDescription"))
      );
    }

    const checkpoints = parseCheckpoints(xml);
    const latest = checkpoints[checkpoints.length - 1] ?? null;
    const latestCode = latest?.raw_code ?? null;

    return {
      status: mapGenikiCheckpoint(latestCode),
      raw_status: latestCode,
      status_label: latest?.description ?? null,
      events: checkpoints.map((c) => ({
        occurred_at: c.occurred_at,
        description: c.description,
        location: c.location,
        raw_code: c.raw_code,
      })),
      raw: { xml: truncate(xml, 2000) },
    };
  }

  // ---------------------------------------------------------------------------
  // SOAP infrastructure
  // ---------------------------------------------------------------------------

  /**
   * Returns a cached or freshly minted authKey. Geniki's typical TTL is
   * around 30 minutes; we use 25 to leave headroom for in-flight calls
   * to finish before the server rejects them.
   */
  private async authKey(): Promise<string> {
    const cached = GenikiProvider.authCache.get(this.secrets.username);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.authKey;
    }

    const body = `
      <sUsrName>${escapeXml(this.secrets.username)}</sUsrName>
      <sUsrPwd>${escapeXml(this.secrets.password)}</sUsrPwd>
      <sAppKey></sAppKey>`;
    const xml = await this.soapRaw("Authenticate", body);
    const result = extractInt(xml, "Result");
    if (result !== 0) {
      throw new Error(
        formatGenikiError("Authenticate", result, extractString(xml, "ErrorDescription"))
      );
    }
    const authKey = extractString(xml, "Key") || extractString(xml, "AuthKey");
    if (!authKey) {
      throw new Error("Geniki Authenticate returned no auth key.");
    }
    GenikiProvider.authCache.set(this.secrets.username, {
      authKey,
      expiresAt: Date.now() + 25 * 60 * 1000,
    });
    return authKey;
  }

  /**
   * SOAP call wrapper with single retry on `Result=11` (auth expired).
   * Use this for every non-Authenticate call.
   */
  private async soap(operation: string, innerBody: string): Promise<string> {
    const xml = await this.soapRaw(operation, innerBody);
    if (extractInt(xml, "Result") === 11) {
      // authKey expired between cache TTL and server expiry — drop and retry.
      GenikiProvider.authCache.delete(this.secrets.username);
      const refreshed = innerBody.replace(
        /<Authentication>[^<]*<\/Authentication>/,
        `<Authentication>${escapeXml(await this.authKey())}</Authentication>`
      );
      return this.soapRaw(operation, refreshed);
    }
    return xml;
  }

  /**
   * Raw SOAP POST. Builds the envelope, sends it, returns the response
   * body as text for downstream extraction.
   */
  private async soapRaw(operation: string, innerBody: string): Promise<string> {
    const url = this.config.base_url || DEFAULT_BASE_URL;
    const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <${operation} xmlns="${SOAP_NAMESPACE}">
      ${innerBody}
    </${operation}>
  </soap:Body>
</soap:Envelope>`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: `"${SOAP_NAMESPACE}/${operation}"`,
        },
        body: envelope,
        signal: AbortSignal.timeout(20_000),
        // Explicit no-store — SOAP responses (rate quotes, station
        // lookups) must always reflect carrier-side state at call time.
        cache: "no-store",
      });
    } catch (e) {
      throw new Error(`Geniki ${operation} request failed: ${(e as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Geniki ${operation} responded ${res.status}: ${truncate(text, 500)}`
      );
    }
    // SOAP Fault sniff — surface the server's fault string verbatim so
    // the admin sees the real cause instead of an empty Result extraction.
    if (text.includes("<soap:Fault>") || text.includes("<faultstring>")) {
      const fault = extractString(text, "faultstring");
      throw new Error(`Geniki ${operation} SOAP fault: ${fault || "unknown"}`);
    }
    return text;
  }
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

/**
 * Maps a Geniki checkpoint status code to our shared StatusCode vocabulary.
 * Geniki uses short Greek-language status codes; the codes below cover the
 * most common ones. Unknown codes default to `in_transit` so the order
 * isn't stuck.
 *
 * Verify the actual code list against Geniki's WSDL / merchant docs —
 * codes vary slightly across Geniki contract versions.
 */
export function mapGenikiCheckpoint(code: string | null): StatusCode {
  if (!code) return "in_transit";
  switch (code.trim().toUpperCase()) {
    case "ΕΓ":
    case "EG":
      return "label_created";
    case "ΠΑ":
    case "PA":
      return "awaiting_carrier";
    case "ΜΕ":
    case "ME":
      return "in_transit";
    case "ΠΡ":
    case "PR":
      return "out_for_delivery";
    case "ΠΛ":
    case "PL":
      return "delivered";
    case "ΠΣ":
    case "PS":
      // "Παραλήφθηκε από σημείο παραλαβής" — customer collected from a
      // locker or branch.
      return "collected";
    case "ΣΣ":
    case "SS":
      // "Στο σημείο παραλαβής" — parcel arrived at the pickup point.
      return "arrived_at_pickup";
    case "ΕΠ":
    case "EP":
      return "returned";
    case "ΑΚ":
    case "AK":
      return "cancelled";
    case "ΑΣ":
    case "AS":
      return "delivery_attempted_absent";
    case "ΑΡΝ":
    case "ARN":
      return "delivery_attempted_refused";
    case "ΛΔ":
    case "LD":
      return "delivery_attempted_wrong_address";
    case "ΑΝ":
    case "AN":
      return "on_hold";
    default:
      return "in_transit";
  }
}

// ---------------------------------------------------------------------------
// Tiny XML extractors
//
// Geniki's responses are flat. These helpers pull `<Tag>value</Tag>` pairs
// with a regex; sufficient for the surface we exercise. If a future
// response shape surfaces nested duplicates, swap to fast-xml-parser.
// ---------------------------------------------------------------------------

function extractString(xml: string, tag: string): string {
  const escaped = tag.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  const m = xml.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`));
  if (!m) return "";
  return decodeXmlEntities(m[1].trim());
}

function extractInt(xml: string, tag: string): number {
  const raw = extractString(xml, tag);
  if (!raw) return Number.NaN;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * Pulls all instances of a repeating wrapper tag (e.g. `<ShopInfo>...</ShopInfo>`)
 * and extracts a normalized location shape from each. Tag names inside the
 * wrapper match the most common Geniki schema; verify against your WSDL
 * if any field comes back empty.
 */
function parseLocations(xml: string, wrapper: string): GenikiLocation[] {
  const escaped = wrapper.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  const out: GenikiLocation[] = [];
  const re = new RegExp(`<${escaped}>([\\s\\S]*?)<\\/${escaped}>`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const inner = match[1];
    const id =
      extractString(inner, "ShopId") ||
      extractString(inner, "LockerId") ||
      extractString(inner, "Id");
    if (!id) continue;
    out.push({
      location_id: id,
      name: extractString(inner, "Name") || extractString(inner, "Description"),
      address: extractString(inner, "Address") || null,
      zipcode: extractString(inner, "ZipCode") || null,
      area: extractString(inner, "Area") || extractString(inner, "City") || null,
      phones: extractString(inner, "Phone") || extractString(inner, "Phones") || null,
      working_hours: extractString(inner, "WorkingHours") || null,
      lat: parseFloatOrNull(extractString(inner, "Lat") || extractString(inner, "Latitude")),
      lng: parseFloatOrNull(extractString(inner, "Lng") || extractString(inner, "Longitude")),
    });
  }
  return out;
}

function parseCheckpoints(xml: string): GenikiCheckpoint[] {
  const re = /<Checkpoint>([\s\S]*?)<\/Checkpoint>/g;
  const out: GenikiCheckpoint[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const inner = match[1];
    out.push({
      occurred_at: extractString(inner, "Date") || new Date().toISOString(),
      description: extractString(inner, "Description") || "",
      location: extractString(inner, "Location") || null,
      raw_code: extractString(inner, "Status") || extractString(inner, "Code") || null,
    });
  }
  return out;
}

function parseFloatOrNull(raw: string): number | null {
  if (!raw) return null;
  const n = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function formatGenikiError(
  operation: string,
  result: number,
  description: string
): string {
  if (description) return `Geniki ${operation} → Result ${result}: ${description}`;
  return `Geniki ${operation} → Result ${result}`;
}

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export interface GenikiLocation {
  location_id: string;
  name: string;
  address: string | null;
  zipcode: string | null;
  area: string | null;
  phones: string | null;
  working_hours: string | null;
  lat: number | null;
  lng: number | null;
}

interface GenikiCheckpoint {
  occurred_at: string;
  description: string;
  location: string | null;
  raw_code: string | null;
}
