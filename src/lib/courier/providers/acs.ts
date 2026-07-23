import "server-only";
import type {
  AcsConfig,
  AcsSecrets,
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

const DEFAULT_BASE_URL =
  "https://webservices.acscourier.net/ACSRestServices/api/ACSAutoRest";

/**
 * Resolved postcode → station info as ACS returns it on
 * ACS_Area_Find_By_Zip_Code.
 */
export interface AcsAreaResolution {
  station_id: string | null;
  branch_id: number | null;
  is_inaccessible: boolean;
  area_label: string | null;
}

/**
 * Subset of ACS_SHOP_* fields we project from the ACS_Stations response.
 * Persisted into couriers_location_cache: the shared fields
 * (name, address, zipcode, lat, lng, etc.) go into top-level columns; the
 * ACS-specific extras (truck pickup hours, station_id_en, services) land
 * in the row's `raw` JSONB so they survive without forcing a column on
 * every other carrier.
 */
export interface AcsStation {
  station_id: string;
  station_id_en: string | null;
  branch_id: number;
  shop_kind: number | null;
  country: string;
  description: string | null;
  area_id: number | null;
  area_descr: string | null;
  address: string | null;
  zipcode: string | null;
  phones: string | null;
  working_hours: string | null;
  working_hours_sat: string | null;
  truck_pickup_hours: string | null;
  lat: number | null;
  lng: number | null;
  email: string | null;
  services: string | null;
}

/**
 * ACS Courier REST provider.
 *
 * Single endpoint dispatch: every call hits the same URL with an `ACSAlias`
 * field naming the method (ACS_Create_Voucher, ACS_Price_Calculation,
 * ACS_Trackingsummary, ACS_Area_Find_By_Zip_Code, ACS_Stations, etc.) and an
 * `ACSInputParameters` object carrying credentials + per-call payload. Auth
 * uses an `AcsApiKey` HTTP header.
 *
 * Phase 3 implements the read-only quote path: findAreaByZip, priceCalculate,
 * and listStations. createVoucher and trackingSummary
 * remain stubs.
 */
export class AcsProvider implements CarrierProvider {
  readonly carrier = "acs" as const;

  constructor(
    private readonly config: AcsConfig,
    private readonly secrets: AcsSecrets
  ) {}

  /**
   * Phase 4 — capabilities ACS can service today. Reflects ACTUAL coded
   * features, not aspirational ones:
   *
   *   address_validation         — findAreaByZip is shipped
   *   surface_inaccessibility    — derived from findAreaByZip ('ΔΠ' flag)
   *   fetch_price_quote          — priceCalculate is shipped
   *   apply_remote_surcharge     — sending 'REM' is straightforward; Phase 5 wires it
   *   list_smartpoints           — listStations supports KIND=7; Phase 6 fetches it
   *   list_branches              — listStations supports KIND=1
   *   store_api_quote_for_audit  — audit population already in resolveFees
   *
   * NOT yet supported (provider class has stubs):
   *   create_voucher    — Phase 8
   *   fetch_tracking    — Phase 8 (trackingSummary stub)
   *   batch_finalize    — Phase 8 (Issue_Pickup_List not implemented)
   *   cancel_voucher    — Phase 8
   *
   * ACS does NOT support defer_locker_selection (BoxNow only).
   */
  supportedCapabilities(): Set<Capability> {
    return new Set<Capability>([
      "address_validation",
      "surface_inaccessibility",
      "fetch_price_quote",
      "apply_remote_surcharge",
      "list_smartpoints",
      "list_branches",
      "store_api_quote_for_audit",
      // Phase 8 — voucher creation, cancellation, and tracking are now wired.
      "create_voucher",
      "cancel_voucher",
      "fetch_tracking",
      // Phase 8b — daily batch close via Issue_Pickup_List.
      "batch_finalize",
    ]);
  }

  /**
   * Cheap health check. Same call shape as findAreaByZip but with a known
   * Athens postcode — exercises credentials + key header in one shot.
   */
  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    try {
      const res = await this.call("ACS_Area_Find_By_Zip_Code", {
        Zip_Code: "10434",
        Country: "GR",
        Show_Only_Inaccessible_Areas: 0,
      });
      if (res.ACSExecution_HasError) {
        return {
          ok: false,
          message: res.ACSExecutionErrorMessage || "ACS returned an unspecified error.",
        };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  // ---------------------------------------------------------------------------
  // Read-only endpoints
  // ---------------------------------------------------------------------------

  /**
   * Resolves a postcode to its destination station. Returns the first matching
   * area row (typical case: all areas under a zipcode share a station). Sets
   * `is_inaccessible=true` when ANY area row carries the 'ΔΠ' flag — the
   * customer-facing flow uses that to surface a remote-area warning.
   */
  async findAreaByZip(
    zipcode: string,
    country: string = "GR"
  ): Promise<AcsAreaResolution> {
    const res = await this.call("ACS_Area_Find_By_Zip_Code", {
      Zip_Code: zipcode,
      Country: country,
      Show_Only_Inaccessible_Areas: 0,
    });
    if (res.ACSExecution_HasError) {
      throw new Error(res.ACSExecutionErrorMessage || "ACS_Area_Find_By_Zip_Code failed");
    }
    const rows = (res.ACSOutputResponce?.ACSTableOutput?.Table_Data ?? []) as Array<{
      Station_ID?: string;
      Branch_ID?: number;
      Area?: string;
      Description?: string;
      Inaccessible_Area_Kind?: string;
    }>;
    if (rows.length === 0) {
      return { station_id: null, branch_id: null, is_inaccessible: false, area_label: null };
    }
    const first = rows[0];
    const isInaccessible = rows.some(
      (r) => typeof r.Inaccessible_Area_Kind === "string" && r.Inaccessible_Area_Kind.trim() !== ""
    );
    return {
      station_id: first.Station_ID ?? null,
      branch_id: first.Branch_ID ?? null,
      is_inaccessible: isInaccessible,
      area_label: first.Area ?? first.Description ?? null,
    };
  }

  /**
   * Quotes shipping + COD. ACS returns Basic_Ammount (shipping) and
   * Extra_Service_Ammount (COD surcharge when Acs_Delivery_Products='COD' is
   * sent, otherwise other delivery products). Both are excl. VAT — the
   * resolver stores them as-is to compare directly against custom-rule
   * amounts which are also stored excl. VAT.
   */
  async priceCalculate(ctx: PriceContext): Promise<PriceQuote> {
    const destStation = ctx.station_destination
      ? String(ctx.station_destination)
      : (await this.findAreaByZip(ctx.recipient_zipcode, ctx.recipient_country ?? "GR")).station_id;
    if (!destStation) {
      throw new Error(`ACS could not resolve a station for zipcode ${ctx.recipient_zipcode}.`);
    }

    const isCod = (ctx.cod_amount ?? 0) > 0;
    const applyRem = ctx.apply_remote_surcharge === true;

    // ACS service flags are comma-separated. Build the list dynamically so
    // future services (SAT, MDV, etc.) can be added the same way.
    const deliveryProducts: string[] = [];
    if (isCod) deliveryProducts.push("COD");
    if (applyRem) deliveryProducts.push("REM");

    const params: Record<string, unknown> = {
      Billing_Code: this.config.billing_code,
      Billing_Category: 2,
      Acs_Station_Origin: this.config.origin_station,
      Acs_Station_Destination: destStation,
      // ACS expects weight as a Greek-locale decimal string (',' not '.').
      Weight: (ctx.weight_kg ?? 0).toFixed(2).replace(".", ","),
      Pickup_Date: new Date().toISOString().slice(0, 10),
      Acs_Delivery_Products: deliveryProducts.length > 0 ? deliveryProducts.join(",") : null,
      Charge_Type: this.config.default_charge_type ?? 2,
      Delivery_Zone: null,
      Insurance_Ammount: null,
      Dimension_X_In_Cm: ctx.dimension_x_cm ?? null,
      Dimension_Y_In_Cm: ctx.dimension_y_cm ?? null,
      Dimension_Z_In_Cm: ctx.dimension_z_cm ?? null,
    };

    const res = await this.call("ACS_Price_Calculation", params);
    if (res.ACSExecution_HasError) {
      throw new Error(res.ACSExecutionErrorMessage || "ACS_Price_Calculation failed");
    }

    const out = (res.ACSOutputResponce?.ACSValueOutput?.[0] ?? {}) as {
      Basic_Ammount?: number;
      Extra_Service_Ammount?: number;
      Total_Ammount?: number;
      Total_Vat_Ammount?: number;
      Error_Message?: string;
    };
    if (out.Error_Message) {
      throw new Error(out.Error_Message);
    }

    const shipping = Number(out.Basic_Ammount ?? 0);
    const extras = Number(out.Extra_Service_Ammount ?? 0);

    // ACS returns the sum of all extra services in a single Extra_Service_Ammount
    // field — it doesn't decompose per-service. Attribution rules:
    //   COD only          → cod_handling = extras (matches existing behavior)
    //   REM only          → extras={ remote_area_surcharge: extras }, cod=0
    //   COD + REM         → cod_handling = extras (best effort; the line will
    //                       be labelled as COD handling but actually includes
    //                       both charges). Phase 5 accepts this attribution
    //                       fuzziness; a future call-twice strategy could split.
    //   no extras flagged → bucket any residual into `other_services` for audit
    let codHandling = 0;
    const extrasMap: Record<string, number> = {};
    if (isCod) {
      codHandling = extras;
    } else if (applyRem && extras > 0) {
      extrasMap.remote_area_surcharge = extras;
    } else if (extras > 0) {
      extrasMap.other_services = extras;
    }

    return {
      shipping,
      cod_handling: codHandling,
      extras: extrasMap,
      currency: "EUR",
      raw: res,
    };
  }

  /**
   * Returns ACS stores for the given country + kind. The merchant settings
   * page invokes this on-demand; the result is cached for 30 days in
   * couriers_location_cache (carrier='acs'). Phase 3 onwards consumes
   * ACS_SHOP_KIND=1 (central stores) for the customer-facing pickup picker,
   * and Phase 7 added KIND=7 (Smartpoints) for locker delivery.
   */
  async listStations(country: string = "GR", shopKind: number = 1): Promise<AcsStation[]> {
    const res = await this.call("ACS_Stations", {
      ACS_SHOP_COUNTRY_ID: country,
      ACS_SHOP_KIND: shopKind,
    });
    if (res.ACSExecution_HasError) {
      throw new Error(res.ACSExecutionErrorMessage || "ACS_Stations failed");
    }
    const rows = (res.ACSOutputResponce?.ACSTableOutput?.Table_Data ?? []) as Array<
      Record<string, unknown>
    >;
    return rows.map((r) => ({
      station_id: String(r.ACS_SHOP_STATION_ID ?? ""),
      station_id_en: r.ACS_SHOP_STATION_ID_EN ? String(r.ACS_SHOP_STATION_ID_EN) : null,
      branch_id: Number(r.ACS_SHOP_BRANCH_ID ?? 1),
      shop_kind: r.ACS_SHOP_KIND ? Number(r.ACS_SHOP_KIND) : shopKind,
      country,
      description: r.ACS_SHOP_STATION_DESCR ? String(r.ACS_SHOP_STATION_DESCR) : null,
      area_id: r.ACS_SHOP_AREA_ID ? Number(r.ACS_SHOP_AREA_ID) : null,
      area_descr: r.ACS_SHOP_AREA_DESCR ? String(r.ACS_SHOP_AREA_DESCR) : null,
      address: r.ACS_SHOP_ADDRESS ? String(r.ACS_SHOP_ADDRESS) : null,
      zipcode: r.ACS_SHOP_ZIPCODE ? String(r.ACS_SHOP_ZIPCODE) : null,
      phones: r.ACS_SHOP_PHONES ? String(r.ACS_SHOP_PHONES) : null,
      working_hours: r.ACS_SHOP_WORKING_HOURS ? String(r.ACS_SHOP_WORKING_HOURS) : null,
      working_hours_sat: r.ACS_SHOP_WORKING_HOURS_SATURDAY
        ? String(r.ACS_SHOP_WORKING_HOURS_SATURDAY)
        : null,
      truck_pickup_hours: r.ACS_SHOP_TRUCK_PICKUP_HOURS
        ? String(r.ACS_SHOP_TRUCK_PICKUP_HOURS)
        : null,
      lat: r.ACS_SHOP_LAT ? Number(r.ACS_SHOP_LAT) : null,
      lng: r.ACS_SHOP_LONG ? Number(r.ACS_SHOP_LONG) : null,
      email: r.ACS_SHOP_EMAIL ? String(r.ACS_SHOP_EMAIL) : null,
      services: r.ACS_SHOP_SERVICES ? String(r.ACS_SHOP_SERVICES) : null,
    }));
  }

  // ---------------------------------------------------------------------------
  // Phase 8 — voucher creation, cancellation, tracking
  // ---------------------------------------------------------------------------

  /**
   * Builds an ACS voucher (ACS_Create_Voucher). Returns the voucher number,
   * which becomes the order's tracking_number. Caller is responsible for
   * idempotency — calling twice for the same order would create two
   * vouchers.
   *
   * Pickup handling:
   *   pickup_type='branch'  → adds REC to Acs_Delivery_Products, routes via
   *                           pickup_station_id + pickup_branch_id
   *   pickup_type='locker'  → same routing, BUT Recipient_Cellphone is
   *                           mandatory (ACS sends the locker code via SMS)
   *   pickup_type=null      → home delivery; standard routing
   *
   * Per ACS docs, REC + SAT can't co-exist. We don't ship SAT today so no
   * combination conflict; revisit when we add Saturday delivery.
   */
  async createVoucher(ctx: VoucherContext): Promise<VoucherResult> {
    const country = (ctx.recipient_country ?? "GR").toUpperCase();
    const isPickup = ctx.pickup_type === "branch" || ctx.pickup_type === "locker";
    const isLocker = ctx.pickup_type === "locker";

    // Smartpoint validation — ACS rejects locker vouchers without a mobile
    // phone, so catch it client-side with a clear error rather than waiting
    // for the cryptic carrier response.
    if (isLocker && !ctx.recipient_cellphone?.trim()) {
      throw new Error(
        "Smartpoint delivery requires a recipient mobile phone (ACS sends the locker code via SMS)."
      );
    }

    // Resolve the destination station. For pickup orders, the customer's
    // chosen pickup_station_id is the destination. For home delivery, we
    // resolve via findAreaByZip (the cache typically already has it from
    // the checkout-time quote, but we fall through to a fresh call when
    // missing).
    let destStation: string;
    let destBranch: number;
    if (isPickup) {
      if (!ctx.pickup_station_id) {
        throw new Error("Pickup voucher missing pickup_station_id.");
      }
      destStation = ctx.pickup_station_id;
      destBranch = ctx.pickup_branch_id ?? 1;
    } else {
      const area = await this.findAreaByZip(ctx.recipient_zipcode, country);
      if (!area.station_id) {
        throw new Error(
          `ACS could not resolve a destination station for zipcode ${ctx.recipient_zipcode}.`
        );
      }
      destStation = area.station_id;
      destBranch = area.branch_id ?? 1;
    }

    const isCod = (ctx.cod_amount ?? 0) > 0;
    const deliveryProducts: string[] = [];
    if (isPickup) deliveryProducts.push("REC");
    if (isCod) deliveryProducts.push("COD");

    const params: Record<string, unknown> = {
      Billing_Code: this.config.billing_code,
      Billing_Category: 2,
      Sender: this.config.sender_name,
      Acs_Station_Origin: this.config.origin_station,
      Acs_Station_Destination: destStation,
      Acs_Station_Branch_Destination: destBranch,
      Pickup_Date: new Date().toISOString().slice(0, 10),
      Recipient_Name: ctx.recipient_name,
      Recipient_Address: ctx.recipient_address,
      Recipient_Address_Number: ctx.recipient_address_number ?? null,
      Recipient_Zipcode: ctx.recipient_zipcode,
      Recipient_Region: ctx.recipient_region ?? null,
      Recipient_Country: country,
      Recipient_Phone: ctx.recipient_phone ?? null,
      Recipient_Cellphone: ctx.recipient_cellphone ?? null,
      Recipient_Email: ctx.recipient_email ?? null,
      Item_Quantity: ctx.item_quantity,
      // ACS expects weight as a Greek-locale decimal string (',' not '.').
      Weight: (ctx.weight_kg ?? 0).toFixed(2).replace(".", ","),
      Cod_Ammount: isCod ? ctx.cod_amount : null,
      // 0 = cash, 1 = cheque. Default to cash; ACS docs don't show cheque
      // as a customer-facing payment method for COD orders.
      Cod_Payment_Way: isCod ? 0 : null,
      Acs_Delivery_Products: deliveryProducts.length > 0 ? deliveryProducts.join(",") : null,
      Charge_Type: this.config.default_charge_type ?? 2,
      Delivery_Notes: ctx.delivery_notes ?? null,
      // Reference_Key1 is our order ID — used to look up the voucher later
      // from our system without exposing tracking numbers to support staff.
      Reference_Key1: ctx.order_id,
      Reference_Key2: ctx.order_number,
      With_Return_Voucher: 0,
      Language: this.config.language ?? "EN",
    };

    const res = await this.call("ACS_Create_Voucher", params);
    if (res.ACSExecution_HasError) {
      throw new Error(
        res.ACSExecutionErrorMessage || "ACS_Create_Voucher failed"
      );
    }

    const out = (res.ACSOutputResponce?.ACSValueOutput?.[0] ?? {}) as {
      Voucher_No?: string | number;
      Error_Message?: string;
    };
    if (out.Error_Message) {
      throw new Error(out.Error_Message);
    }
    const voucherNo = out.Voucher_No ? String(out.Voucher_No) : null;
    if (!voucherNo) {
      throw new Error("ACS_Create_Voucher returned no voucher number.");
    }

    return {
      voucher_number: voucherNo,
      // ACS doesn't return URLs directly; the customer-facing tracking link
      // is built from delivery_carriers.tracking_url_template + voucher_no
      // via buildTrackingUrl. Returning null here keeps the contract clean.
      tracking_url: null,
      label_url: null,
      raw: res,
    };
  }

  /**
   * Cancels an ACS voucher (ACS_Cancel_Voucher). Per the ACS docs, this is
   * only possible BEFORE the voucher has been included in a pickup list
   * (Issue_Pickup_List). After that, the cancel call returns an error and
   * the merchant must handle the cancellation manually with ACS support.
   */
  async cancelVoucher(voucherNumber: string): Promise<CancelResult> {
    if (!voucherNumber.trim()) {
      return { ok: false, message: "Λείπει ο αριθμός voucher." };
    }
    const res = await this.call("ACS_Cancel_Voucher", {
      Voucher_No: voucherNumber.trim(),
    });
    if (res.ACSExecution_HasError) {
      return {
        ok: false,
        message: res.ACSExecutionErrorMessage || "ACS_Cancel_Voucher failed",
        raw: res,
      };
    }
    const out = (res.ACSOutputResponce?.ACSValueOutput?.[0] ?? {}) as {
      Error_Message?: string;
    };
    if (out.Error_Message) {
      return { ok: false, message: out.Error_Message, raw: res };
    }
    return { ok: true, raw: res };
  }

  /**
   * Fetches the latest tracking summary + checkpoint events for a voucher.
   * Calls both ACS_Trackingsummary (for shipment_status + delivery_flag +
   * non_delivery_reason_code) and ACS_TrackingDetails (for the checkpoint
   * event stream). Maps the composite into our StatusCode vocabulary.
   *
   * Status mapping is best-effort: ACS doesn't standardize the
   * non_delivery_reason_code attribution. We fall through to `in_transit`
   * when status_code is 5 without a recognized sub-reason.
   */
  async trackingSummary(trackingNumber: string): Promise<TrackingResult> {
    const [summaryRes, detailsRes] = await Promise.all([
      this.call("ACS_Trackingsummary", {
        Voucher_No: trackingNumber,
        Language: this.config.language ?? "EN",
      }),
      this.call("ACS_TrackingDetails", {
        Voucher_No: trackingNumber,
        Language: this.config.language ?? "EN",
      }),
    ]);
    if (summaryRes.ACSExecution_HasError) {
      throw new Error(
        summaryRes.ACSExecutionErrorMessage || "ACS_Trackingsummary failed"
      );
    }

    const summary = (summaryRes.ACSOutputResponce?.ACSValueOutput?.[0] ?? {}) as {
      delivery_flag?: 0 | 1;
      returned_flag?: 0 | 1;
      non_delivery_reason_code?: string | null;
      shipment_status?: number;
      delivery_info?: string | null;
    };

    const events =
      ((detailsRes.ACSOutputResponce?.ACSTableOutput?.Table_Data ?? []) as Array<{
        checkpoint_date_time?: string;
        checkpoint_action?: string;
        checkpoint_location?: string;
        checkpoint_notes?: string;
      }>).map((e) => ({
        occurred_at: e.checkpoint_date_time ?? new Date().toISOString(),
        description: e.checkpoint_action?.trim() ?? "",
        location: e.checkpoint_location?.trim() ?? null,
        raw_code: null,
      }));

    const status = mapAcsShipmentStatus(
      summary.shipment_status ?? 0,
      summary.non_delivery_reason_code ?? null,
      summary.delivery_flag ?? 0,
      summary.returned_flag ?? 0
    );
    const rawComposite = composeRawStatus(
      summary.shipment_status,
      summary.non_delivery_reason_code,
      summary.delivery_flag,
      summary.returned_flag
    );

    return {
      status,
      raw_status: rawComposite,
      status_label: summary.delivery_info?.trim() ?? null,
      events,
      raw: summaryRes,
    };
  }

  /**
   * Phase 8b — closes the day's pending vouchers via
   * `ACS_Issue_Pickup_List`. ACS treats every voucher created since the
   * last pickup-list close as pending; this call seals them into a numbered
   * batch and returns the PickupList_No. Couriers won't physically collect
   * vouchers that haven't been included in a pickup list, and uncancellable
   * after this call — so it's the merchant's hard handoff signal.
   *
   * The endpoint takes no parameters beyond credentials (which the call()
   * wrapper supplies). All open vouchers are picked up automatically.
   */
  async finalizeBatch(): Promise<FinalizeBatchResult> {
    const res = await this.call("ACS_Issue_Pickup_List", {});
    if (res.ACSExecution_HasError) {
      return {
        ok: false,
        message:
          res.ACSExecutionErrorMessage || "ACS_Issue_Pickup_List failed",
        raw: res,
      };
    }
    const out = (res.ACSOutputResponce?.ACSValueOutput?.[0] ?? {}) as {
      PickupList_No?: string | number;
      Voucher_Count?: number;
      Error_Message?: string;
    };
    if (out.Error_Message) {
      return { ok: false, message: out.Error_Message, raw: res };
    }
    return {
      ok: true,
      batch_id: out.PickupList_No != null ? String(out.PickupList_No) : null,
      voucher_count: out.Voucher_Count ?? null,
      raw: res,
    };
  }

  // ---------------------------------------------------------------------------
  // Low-level request wrapper. Centralized so future phases call exactly one
  // place to add logging / retries / circuit-breaker / rate-limit handling.
  // ---------------------------------------------------------------------------

  private async call(
    alias: string,
    params: Record<string, unknown>
  ): Promise<AcsEnvelope> {
    const url = this.config.base_url || DEFAULT_BASE_URL;
    const body = {
      ACSAlias: alias,
      ACSInputParameters: {
        Company_ID: this.secrets.company_id,
        Company_Password: this.secrets.company_password,
        User_ID: this.secrets.user_id,
        User_Password: this.secrets.user_password,
        Language: this.config.language ?? "EN",
        ...params,
      },
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          AcsApiKey: this.secrets.api_key,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
        // Explicit no-store — Next.js 15 makes external fetch uncached
        // by default, but being explicit prevents any future config
        // change from accidentally caching courier API responses (which
        // would return stale station/locker lists or rate quotes).
        cache: "no-store",
      });
    } catch (e) {
      throw new Error(`ACS request failed: ${(e as Error).message}`);
    }
    if (!res.ok) {
      throw new Error(`ACS responded ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as AcsEnvelope;
  }
}

/**
 * Envelope shape returned by every ACS endpoint. Note the typo
 * (`ACSOutputResponce`) is in the real API response — preserve it verbatim.
 */
interface AcsEnvelope {
  ACSExecution_HasError: boolean;
  ACSExecutionErrorMessage: string;
  ACSOutputResponce?: {
    ACSValueOutput?: unknown[];
    ACSTableOutput?: { Table_Data?: unknown[] } & Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Phase 8 — status mapping helpers (free functions; no dependency on
// AcsProvider instance state).
// ---------------------------------------------------------------------------

/**
 * Maps the ACS Trackingsummary composite (shipment_status + flags + sub-code)
 * to our shared StatusCode vocabulary. See "Status vocabulary" section of
 * docs/features/courier-integration-design.md for the full table.
 *
 *   shipment_status=4              → delivered (door)
 *   delivery_flag=1 with REC svc   → collected (caller decides; this fn
 *                                     defaults to delivered — the order's
 *                                     pickup_type can override at consumer)
 *   shipment_status=3 + ΑΣ1        → delivery_attempted_absent
 *   shipment_status=1 + ΑΠ*        → delivery_attempted_refused
 *   shipment_status=2 + ΛΣ*        → delivery_attempted_wrong_address
 *   shipment_status=5 + ΠΑ*        → on_hold
 *   shipment_status=5 (other)      → in_transit
 *   returned_flag=1                → returned
 */
function mapAcsShipmentStatus(
  shipmentStatus: number,
  nonDeliveryReasonCode: string | null,
  deliveryFlag: 0 | 1,
  returnedFlag: 0 | 1
): StatusCode {
  if (returnedFlag === 1) return "returned";
  if (deliveryFlag === 1 || shipmentStatus === 4) return "delivered";
  const reason = nonDeliveryReasonCode?.trim() ?? "";
  // Damage sub-codes (ΖΗ*) — surfaced as a distinct exception now that
  // the timeline supports delivery_attempted_damaged. Checked BEFORE
  // the broad shipment_status buckets because the sub-code carries
  // finer-grained intent than the numeric tier.
  if (reason.startsWith("ΖΗ")) return "delivery_attempted_damaged";
  if (shipmentStatus === 3 || reason === "ΑΣ1") return "delivery_attempted_absent";
  if (shipmentStatus === 1) return "delivery_attempted_refused";
  if (shipmentStatus === 2) return "delivery_attempted_wrong_address";
  if (shipmentStatus === 5 && (reason === "ΠΑ2" || reason === "ΠΑ4")) {
    return "on_hold";
  }
  if (shipmentStatus === 5) return "in_transit";
  // shipment_status=0 = voucher issued, not yet scanned-in by ACS. Map
  // to awaiting_carrier so admins see the "waiting for pickup" window
  // distinctly. (Prior behavior fell through to in_transit which lied.)
  if (shipmentStatus === 0) return "awaiting_carrier";
  return "in_transit";
}

/**
 * Composes ACS's multi-field status into a single string for the order's
 * carrier_raw_status column. Format: "{shipment_status}_{sub_reason}_{flags}",
 * e.g. "5_ΔΔ1_d0r0" or "4__d1r0". The order page renders this verbatim as
 * detail; reports can pattern-match.
 */
function composeRawStatus(
  shipmentStatus: number | undefined,
  nonDeliveryReasonCode: string | null | undefined,
  deliveryFlag: 0 | 1 | undefined,
  returnedFlag: 0 | 1 | undefined
): string {
  const sub = nonDeliveryReasonCode?.trim() ?? "";
  return `${shipmentStatus ?? "?"}_${sub}_d${deliveryFlag ?? 0}r${returnedFlag ?? 0}`;
}
