"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { placeOrder } from "@/actions/checkout/placeOrder";
import { previewFees } from "@/actions/checkout/previewFees";
import LocationPicker, {
  type PickupSelection,
} from "@/components/features/checkout/LocationPicker";
import type { FeeBreakdownEntry } from "@/types/fee";
import type { Address } from "@/types/address-book";
import {
  PAYMENT_METHODS,
  DELIVERY_METHODS,
  CARRIERS,
  SUPPORTED_COUNTRIES,
  DEFAULT_COUNTRY,
  type PaymentMethodValue,
  type DeliveryMethodValue,
  type CarrierValue,
} from "@/config/storefront";
import {
  availablePaymentMethods,
  availableCarriers,
  availableDeliveryMethods,
} from "@/config/checkout-compatibility";
import type { DeliveryCarrier } from "@/lib/courier/listActiveCarriers";
import type { ActiveCustomDeliveryMethod } from "@/lib/courier/listActiveCustomDeliveryMethods";
import PhoneCountryInput from "@/components/features/forms/PhoneCountryInput";
import {
  normalizeName,
  normalizeNameAdvanced,
  normalizeSurnameAdvanced,
  type NameNormalizationResult,
  normalizeEmail,
  normalizeZip,
  normalizeAddressLine,
  isValidEmail,
  isValidZip,
  parsePhoneInput,
  DEFAULT_PHONE_COUNTRY,
  getZipMaxLength,
} from "@/lib/forms/normalize";
// SUPPORTED_COUNTRIES now imported from @/config/storefront above.
import type { CountryCode } from "libphonenumber-js";

type PaymentMethod = PaymentMethodValue;
type DeliveryMethod = DeliveryMethodValue;
type Carrier = CarrierValue;

interface AddressForm {
  first_name: string;
  last_name: string;
  street: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  country_code: string;
  phone: string;
}

const EMPTY_ADDRESS: AddressForm = {
  first_name: "",
  last_name: "",
  street: "",
  address_line2: "",
  city: "",
  state: "",
  postal_code: "",
  country_code: DEFAULT_COUNTRY,
  phone: "",
};

// Payment / delivery / carrier options are centralized in storefront.ts.
// Local aliases keep the JSX concise.
const PAYMENT_OPTIONS = PAYMENT_METHODS;
const DELIVERY_OPTIONS = DELIVERY_METHODS;
const CARRIER_OPTIONS = CARRIERS;

interface BuyerForm {
  first_name: string;
  last_name: string;
  email: string;
  /** Subscriber-only digits — no country code, no spaces. Country lives in phoneCountry. */
  phone: string;
  phoneCountry: CountryCode;
}

interface Props {
  /** Saved addresses for this customer (empty if none yet). */
  savedAddresses: Address[];
  /** Currency for display only. */
  currency: string;
  /** Cart subtotal, for the order summary. */
  subtotal: number;
  /** Item count, for the order summary. */
  itemCount: number;
  /**
   * Soft-contention session id from /checkout?session=... — required for the
   * Phase 2 placeOrder path to promote soft holds into reservations atomically.
   */
  checkoutSessionId: string;
  /**
   * Buyer block pre-population. For a returning customer, sourced from their
   * `customers` row so they don't retype. For a brand-new guest, all empty.
   * The buyer block is the *placer* identity; the address sections capture
   * the *recipient* (gift-order pattern).
   */
  initialBuyer: BuyerForm;
  /**
   * Carriers the admin has marked is_active=true. Drives both the carrier
   * dropdown and the delivery-method radios (a method is hidden when no
   * active carrier supports it). Empty array means no carriers are
   * enabled — the customer can only pick store_pickup.
   */
  activeCarriers: DeliveryCarrier[];
  /**
   * Admin-defined relabel options on top of the 4 base methods (e.g.
   * "Παράδοση με Van"). Each carries a base_method for compatibility
   * logic + an optional carrier_slug for scoping. When the customer
   * picks one, the order persists both the base method and the custom
   * slug for receipt rendering.
   */
  activeCustomMethods: ActiveCustomDeliveryMethod[];
}

export default function CheckoutForm({
  savedAddresses,
  currency,
  subtotal,
  itemCount,
  checkoutSessionId,
  initialBuyer,
  activeCarriers,
  activeCustomMethods,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Typeform-style step wizard. Sections below are grouped into steps; only
  // the active step is visible (others are `hidden`, so state is preserved).
  const [step, setStep] = useState(0);

  // Buyer block — who is *placing* the order. Pre-populated from the
  // existing customer row when available. The recipient identity lives in
  // its own override block below; the shipping address section (further
  // down) only carries the physical-location fields.
  const [buyer, setBuyer] = useState<BuyerForm>(initialBuyer);

  // Recipient identity override — only used when "Ίδια στοιχεία με αγοραστή"
  // is unticked. When the checkbox is on, the recipient mirrors the buyer
  // on submit; this state stays untouched and is ignored.
  const [recipientOverride, setRecipientOverride] = useState<{
    first_name: string;
    last_name: string;
    phone: string;
    phoneCountry: CountryCode;
  }>({
    first_name: "",
    last_name: "",
    phone: "",
    phoneCountry: DEFAULT_PHONE_COUNTRY,
  });

  // Per-field validation errors surfaced on submit. Keys are field names;
  // values are display copy. Cleared whenever the user edits.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Inline name suggestions from the Greek-name dictionary. Keyed by
  // field path (e.g. "buyer.first_name"). Up to 3 chips per field; clicking
  // one applies it as the value and clears the row.
  const [nameSuggestions, setNameSuggestions] = useState<Record<string, string[]>>({});

  function handleNameBlur(
    field: string,
    value: string,
    setter: (v: string) => void
  ) {
    // Surnames use a separate dictionary (no diminutive variants). The
    // field path encodes whether this is a first-name or last-name input.
    const normalizer = field.endsWith(".last_name")
      ? normalizeSurnameAdvanced
      : normalizeNameAdvanced;
    const result = normalizer(value, buyer.phoneCountry);
    setter(result.value);
    if (result.confidence === "fuzzy" && result.suggestions.length > 0) {
      setNameSuggestions((prev) => ({ ...prev, [field]: result.suggestions }));
    } else {
      setNameSuggestions((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  function acceptSuggestion(
    field: string,
    suggested: string,
    setter: (v: string) => void
  ) {
    setter(suggested);
    setNameSuggestions((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  // Delivery + payment
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>("home_delivery");
  const [carrier, setCarrier] = useState<Carrier | "">("acs");
  // Phase: custom delivery methods. When a custom method is picked, this
  // holds its slug; deliveryMethod above is forced to the method's
  // base_method so all existing compat logic + UI conditionals keep
  // working unchanged. Cleared when the customer switches to a built-in
  // radio option.
  const [customMethodSlug, setCustomMethodSlug] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    savedAddresses.length > 0 ? "stripe" : "cod"
  );

  // Phase 7 — pickup-point selection. Cleared whenever the delivery method
  // or carrier changes (handled by an effect below + by LocationPicker
  // itself when its inputs change).
  const [pickupSelection, setPickupSelection] = useState<PickupSelection | null>(null);

  // Clear selection on any delivery/carrier transition. LocationPicker also
  // clears on its own (e.g. tab switch), but the redundancy here covers the
  // case where the user switches delivery method to something pickup-
  // unrelated (home_delivery, store_pickup) and we shouldn't carry a stale
  // selection into the order payload.
  useEffect(() => {
    const needsPickup =
      deliveryMethod === "delivery_station_pickup" ||
      deliveryMethod === "carrier_pickup";
    if (!needsPickup && pickupSelection !== null) {
      setPickupSelection(null);
    }
  }, [deliveryMethod, carrier, pickupSelection]);

  // Whenever delivery / carrier / payment change, re-derive the valid option
  // sets and auto-correct any field that's no longer compatible. Pure data
  // flow — no user-visible blocking, just silent landing in a valid state.
  // The compatibility helpers in src/config/checkout-compatibility.ts are
  // the source of truth.
  //
  // Order of resolution:
  //   1. If carrier is set and doesn't support current delivery → switch
  //      delivery (so e.g. picking BoxNow auto-switches to locker).
  //   2. If delivery is store_pickup → carrier must be empty.
  //      Otherwise → carrier must support delivery; if not, reset it.
  //   3. Payment must be valid for the (possibly just-updated) delivery.
  useEffect(() => {
    if (carrier !== "") {
      const validForCarrier = availableDeliveryMethods(carrier, activeCarriers);
      if (!validForCarrier.includes(deliveryMethod)) {
        // Prefer a non-store_pickup option since carrier is irrelevant there.
        const next = validForCarrier.find((d) => d !== "store_pickup") ?? "delivery_station_pickup";
        setDeliveryMethod(next);
        return;
      }
    }

    if (deliveryMethod === "store_pickup") {
      if (carrier !== "") setCarrier("");
    } else {
      const validCarriers = availableCarriers(deliveryMethod, activeCarriers);
      if (carrier !== "" && !validCarriers.some((c) => c.slug === carrier)) {
        setCarrier((validCarriers[0]?.slug ?? "") as Carrier | "");
        return;
      }
    }

    const validPayments = availablePaymentMethods(
      deliveryMethod,
      carrier === "" ? null : carrier
    );
    if (!validPayments.includes(paymentMethod)) {
      setPaymentMethod(validPayments[0]);
    }
  }, [deliveryMethod, carrier, paymentMethod, activeCarriers]);

  // Shipping recipient — defaults to "ίδια στοιχεία με αγοραστή" so the
  // common case (buyer = recipient) is one click. Unticking decouples the
  // recipient block from the buyer block and lets the user fill it
  // independently (gift-order pattern).
  const [shippingSameAsBuyer, setShippingSameAsBuyer] = useState(true);

  // Shipping address — pick from saved or fill in form
  const [shippingMode, setShippingMode] = useState<"saved" | "new">(
    savedAddresses.length > 0 ? "saved" : "new"
  );
  const [shippingId, setShippingId] = useState<string>(
    savedAddresses.find((a) => a.is_default_shipping)?.id ??
      savedAddresses[0]?.id ??
      ""
  );
  const [shippingForm, setShippingForm] = useState<AddressForm>(EMPTY_ADDRESS);

  // Billing
  const [billingSame, setBillingSame] = useState(true);
  const [billingMode, setBillingMode] = useState<"saved" | "new">("saved");
  const [billingId, setBillingId] = useState<string>(
    savedAddresses.find((a) => a.is_default_billing)?.id ??
      savedAddresses[0]?.id ??
      ""
  );
  const [billingForm, setBillingForm] = useState<AddressForm>(EMPTY_ADDRESS);

  const [notes, setNotes] = useState("");

  // Live fee preview — server-side resolution of the same fee rules
  // placeOrder uses. Recomputes whenever the inputs that drive rule matching
  // change (delivery method, carrier, payment, recipient zip/country).
  // Debounced so zipcode keystrokes don't hammer the server.
  //
  // Phase 5 — also tracks the inaccessibility flag returned by previewFees
  // when the carrier has the `surface_inaccessibility` capability on. Drives
  // the remote-area banner in the delivery section.
  const [feePreview, setFeePreview] = useState<{
    total: number;
    breakdown: FeeBreakdownEntry[];
    isInaccessible: boolean;
    carrierDisplayName: string | null;
  } | null>(null);
  const [feePreviewLoading, setFeePreviewLoading] = useState(false);

  const previewZip = shippingMode === "saved"
    ? (savedAddresses.find((a) => a.id === shippingId)?.postal_code ?? "")
    : (shippingForm.postal_code ?? "");
  const previewCountry = shippingMode === "saved"
    ? (savedAddresses.find((a) => a.id === shippingId)?.country_code ?? "GR")
    : (shippingForm.country_code ?? "GR");

  useEffect(() => {
    let cancelled = false;
    setFeePreviewLoading(true);
    const timer = setTimeout(async () => {
      const res = await previewFees({
        payment_method: paymentMethod,
        delivery_method: deliveryMethod,
        carrier: deliveryMethod === "store_pickup" || carrier === ""
          ? null
          : carrier,
        recipient_zipcode: previewZip || undefined,
        recipient_country: previewCountry || undefined,
        station_destination: null,
      });
      if (cancelled) return;
      setFeePreviewLoading(false);
      if (res.success) {
        setFeePreview({
          total: res.data.fees_total,
          breakdown: res.data.fees_breakdown,
          isInaccessible: res.data.is_inaccessible,
          carrierDisplayName: res.data.carrier_display_name,
        });
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [paymentMethod, deliveryMethod, carrier, previewZip, previewCountry]);

  const feesTotal = feePreview?.total ?? 0;
  const total = useMemo(() => subtotal + feesTotal, [subtotal, feesTotal]);

  function buildShipping(): { id?: string; form?: AddressForm } {
    if (deliveryMethod === "store_pickup") return {}; // no shipping address needed
    if (shippingMode === "saved" && shippingId) return { id: shippingId };
    // The recipient identity (first/last name + phone) lives in the buyer
    // section now. When "Ίδια στοιχεία" is ticked, mirror the buyer's
    // values; otherwise use the explicit recipientOverride block. The phone
    // is converted to E.164 at this layer so the order JSONB never carries
    // local-format strings.
    const recipient = shippingSameAsBuyer
      ? {
          first_name: buyer.first_name,
          last_name: buyer.last_name,
          phone: buyer.phone,
          phoneCountry: buyer.phoneCountry,
        }
      : recipientOverride;
    const phoneParsed = parsePhoneInput(recipient.phone, recipient.phoneCountry);
    return {
      form: {
        ...shippingForm,
        // Idempotent normalization so the payload always carries clean
        // values, even if the user submits without blurring a field.
        first_name: normalizeNameAdvanced(recipient.first_name, buyer.phoneCountry).value,
        last_name: normalizeNameAdvanced(recipient.last_name, buyer.phoneCountry).value,
        phone: phoneParsed.e164 || recipient.phone,
        street: normalizeAddressLine(shippingForm.street),
        address_line2: normalizeAddressLine(shippingForm.address_line2),
        city: normalizeAddressLine(shippingForm.city),
        postal_code: normalizeZip(shippingForm.postal_code, shippingForm.country_code),
      },
    };
  }
  function buildBilling(): { id?: string; form?: AddressForm } {
    if (billingSame) return buildShipping();
    if (billingMode === "saved" && billingId) return { id: billingId };
    return { form: billingForm };
  }

  /**
   * Run normalize-then-validate on every user-typed field. Returns a map
   * of field-error messages keyed for the inline UI; empty map = clean.
   * Mirrors the no-leakage policy in error copy: every failure says
   * "check this field," never "this value is not unique" or similar.
   */
  function validate(ship: ReturnType<typeof buildShipping>): Record<string, string> {
    const errs: Record<string, string> = {};

    if (!buyer.first_name.trim()) errs["buyer.first_name"] = "Συμπληρώστε όνομα.";
    if (!buyer.last_name.trim()) errs["buyer.last_name"] = "Συμπληρώστε επώνυμο.";
    const emailNorm = normalizeEmail(buyer.email);
    if (!isValidEmail(emailNorm)) errs["buyer.email"] = "Μη έγκυρο email.";
    const buyerPhone = parsePhoneInput(buyer.phone, buyer.phoneCountry);
    if (!buyerPhone.valid) errs["buyer.phone"] = "Μη έγκυρο τηλέφωνο.";

    if (!shippingSameAsBuyer) {
      if (!recipientOverride.first_name.trim())
        errs["recipient.first_name"] = "Συμπληρώστε όνομα παραλήπτη.";
      if (!recipientOverride.last_name.trim())
        errs["recipient.last_name"] = "Συμπληρώστε επώνυμο παραλήπτη.";
      const recipPhone = parsePhoneInput(
        recipientOverride.phone,
        recipientOverride.phoneCountry
      );
      if (!recipPhone.valid) errs["recipient.phone"] = "Μη έγκυρο τηλέφωνο παραλήπτη.";
    }

    if (deliveryMethod !== "store_pickup" && !ship.id && ship.form) {
      const f = ship.form;
      if (!f.street?.trim()) errs["ship.street"] = "Συμπληρώστε διεύθυνση.";
      if (!f.city?.trim()) errs["ship.city"] = "Συμπληρώστε πόλη.";
      const zipCountry = f.country_code || "GR";
      const zipNorm = normalizeZip(f.postal_code ?? "", zipCountry);
      if (!isValidZip(zipNorm, zipCountry))
        errs["ship.postal_code"] = "Μη έγκυρος Τ.Κ.";
    }
    return errs;
  }

  function submit() {
    setError(null);
    setFieldErrors({});
    const ship = buildShipping();
    const bill = buildBilling();

    const errs = validate(ship);
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setError("Ελέγξτε τα στοιχεία της φόρμας.");
      return;
    }

    // Buyer normalized once more at submit (idempotent — survives the case
    // where the user submits without blurring a field).
    const emailFinal = normalizeEmail(buyer.email);
    const buyerPhoneE164 = parsePhoneInput(buyer.phone, buyer.phoneCountry).e164;

    startTransition(async () => {
      const r = await placeOrder({
        payment_method: paymentMethod,
        delivery_method: deliveryMethod,
        carrier:
          deliveryMethod === "store_pickup" || carrier === "" ? null : carrier,
        buyer: {
          first_name: normalizeNameAdvanced(buyer.first_name, buyer.phoneCountry).value || undefined,
          last_name: normalizeNameAdvanced(buyer.last_name, buyer.phoneCountry).value || undefined,
          email: emailFinal || undefined,
          phone: buyerPhoneE164 || undefined,
        },
        shipping_address_id: ship.id ?? null,
        shipping_address: ship.form
          ? mapAddressFormToJson(ship.form)
          : undefined,
        billing_address_id: bill.id ?? null,
        billing_address: bill.form
          ? mapAddressFormToJson(bill.form)
          : undefined,
        customer_notes: notes.trim() || undefined,
        checkout_session_id: checkoutSessionId,
        // Phase 7 — pickup selection from LocationPicker. Only set for
        // locker/branch deliveries; null otherwise. placeOrder validates
        // this matches the delivery method.
        pickup: pickupSelection
          ? {
              carrier: pickupSelection.carrier,
              station_id: pickupSelection.station_id,
              branch_id: pickupSelection.branch_id,
              type: pickupSelection.type,
            }
          : undefined,
        // Custom relabel layer — when the customer picked an admin-defined
        // method like "Παράδοση με Van", we record its slug separately
        // from the underlying delivery_method (base_method) so receipts
        // can render the custom display_name.
        custom_delivery_method_slug: customMethodSlug ?? undefined,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      const target =
        r.data.next_step === "payment"
          ? `/checkout/payment/${r.data.order_id}`
          : `/checkout/success/${r.data.order_id}`;
      router.push(target);
    });
  }

  return (
    <div className="space-y-6">
      <CheckoutSteps current={step} labels={STEP_LABELS} />

      {/* Step 1 — buyer / recipient */}
      <div className={step === 0 ? "" : "hidden"}>
      <section className="border border-stone-taupe/20 rounded-sm bg-card p-4 space-y-4">
        <div>
          <h2 className="font-semibold">1. Στοιχεία αγοραστή / παραλήπτη</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Σε ποιον γράφεται η παραγγελία. Αν στέλνετε σε άλλον,
            ξεμαρκάρετε το «Ίδια στοιχεία» πιο κάτω και συμπληρώστε τα
            στοιχεία του παραλήπτη.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Αγοραστής
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            <div>
              <input
                value={buyer.first_name}
                onChange={(e) => setBuyer({ ...buyer, first_name: e.target.value })}
                onBlur={() =>
                  handleNameBlur("buyer.first_name", buyer.first_name, (v) =>
                    setBuyer((b) => ({ ...b, first_name: v }))
                  )
                }
                placeholder="Όνομα"
                className={`w-full border rounded px-2 py-1 ${fieldErrors["buyer.first_name"] ? "border-destructive" : ""}`}
              />
              {nameSuggestions["buyer.first_name"]?.length ? (
                <div className="flex flex-wrap items-center gap-1 mt-0.5 text-xs">
                  <span className="text-muted-foreground">Μήπως εννοείτε:</span>
                  {nameSuggestions["buyer.first_name"].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() =>
                        acceptSuggestion("buyer.first_name", s, (v) =>
                          setBuyer((b) => ({ ...b, first_name: v }))
                        )
                      }
                      className="text-primary underline"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div>
              <input
                value={buyer.last_name}
                onChange={(e) => setBuyer({ ...buyer, last_name: e.target.value })}
                onBlur={() =>
                  handleNameBlur("buyer.last_name", buyer.last_name, (v) =>
                    setBuyer((b) => ({ ...b, last_name: v }))
                  )
                }
                placeholder="Επώνυμο"
                className={`w-full border rounded px-2 py-1 ${fieldErrors["buyer.last_name"] ? "border-destructive" : ""}`}
              />
              {nameSuggestions["buyer.last_name"]?.length ? (
                <div className="flex flex-wrap items-center gap-1 mt-0.5 text-xs">
                  <span className="text-muted-foreground">Μήπως εννοείτε:</span>
                  {nameSuggestions["buyer.last_name"].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() =>
                        acceptSuggestion("buyer.last_name", s, (v) =>
                          setBuyer((b) => ({ ...b, last_name: v }))
                        )
                      }
                      className="text-primary underline"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <input
              type="email"
              inputMode="email"
              value={buyer.email}
              onChange={(e) => setBuyer({ ...buyer, email: e.target.value })}
              onBlur={() =>
                setBuyer({ ...buyer, email: normalizeEmail(buyer.email) })
              }
              placeholder="Email"
              className={`border rounded px-2 py-1 ${fieldErrors["buyer.email"] ? "border-destructive" : ""}`}
            />
            <PhoneCountryInput
              value={buyer.phone}
              country={buyer.phoneCountry}
              onChange={({ value, country }) =>
                setBuyer({ ...buyer, phone: value, phoneCountry: country })
              }
              invalid={Boolean(fieldErrors["buyer.phone"])}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm pt-1 border-t">
          <input
            type="checkbox"
            checked={shippingSameAsBuyer}
            onChange={(e) => setShippingSameAsBuyer(e.target.checked)}
            className="mt-2"
          />
          <span className="mt-2">Ίδια στοιχεία παραλήπτη με αγοραστή</span>
        </label>

        {!shippingSameAsBuyer && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Παραλήπτης
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <div>
                <input
                  value={recipientOverride.first_name}
                  onChange={(e) =>
                    setRecipientOverride({ ...recipientOverride, first_name: e.target.value })
                  }
                  onBlur={() =>
                    handleNameBlur("recipient.first_name", recipientOverride.first_name, (v) =>
                      setRecipientOverride((r) => ({ ...r, first_name: v }))
                    )
                  }
                  placeholder="Όνομα"
                  className={`w-full border rounded px-2 py-1 ${fieldErrors["recipient.first_name"] ? "border-destructive" : ""}`}
                />
                {nameSuggestions["recipient.first_name"]?.length ? (
                  <div className="flex flex-wrap items-center gap-1 mt-0.5 text-xs">
                    <span className="text-muted-foreground">Μήπως εννοείτε:</span>
                    {nameSuggestions["recipient.first_name"].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() =>
                          acceptSuggestion("recipient.first_name", s, (v) =>
                            setRecipientOverride((r) => ({ ...r, first_name: v }))
                          )
                        }
                        className="text-primary underline"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div>
                <input
                  value={recipientOverride.last_name}
                  onChange={(e) =>
                    setRecipientOverride({ ...recipientOverride, last_name: e.target.value })
                  }
                  onBlur={() =>
                    handleNameBlur("recipient.last_name", recipientOverride.last_name, (v) =>
                      setRecipientOverride((r) => ({ ...r, last_name: v }))
                    )
                  }
                  placeholder="Επώνυμο"
                  className={`w-full border rounded px-2 py-1 ${fieldErrors["recipient.last_name"] ? "border-destructive" : ""}`}
                />
                {nameSuggestions["recipient.last_name"]?.length ? (
                  <div className="flex flex-wrap items-center gap-1 mt-0.5 text-xs">
                    <span className="text-muted-foreground">Μήπως εννοείτε:</span>
                    {nameSuggestions["recipient.last_name"].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() =>
                          acceptSuggestion("recipient.last_name", s, (v) =>
                            setRecipientOverride((r) => ({ ...r, last_name: v }))
                          )
                        }
                        className="text-primary underline"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="md:col-span-2">
                <PhoneCountryInput
                  value={recipientOverride.phone}
                  country={recipientOverride.phoneCountry}
                  onChange={({ value, country }) =>
                    setRecipientOverride({
                      ...recipientOverride,
                      phone: value,
                      phoneCountry: country,
                    })
                  }
                  invalid={Boolean(fieldErrors["recipient.phone"])}
                />
              </div>
            </div>
          </div>
        )}
      </section>
      </div>

      {/* Step 2 — shipping + billing addresses */}
      <div className={step === 1 ? "" : "hidden"}>
      {deliveryMethod !== "store_pickup" && (
        <section className="border border-stone-taupe/20 rounded-sm bg-card p-4 space-y-3">
          <h2 className="font-semibold">2. Διεύθυνση αποστολής</h2>
          {savedAddresses.length > 0 && (
            <div className="flex gap-2 text-sm">
              <button
                type="button"
                onClick={() => setShippingMode("saved")}
                className={`rounded px-3 py-1 ${
                  shippingMode === "saved" ? "bg-primary text-primary-foreground" : "border"
                }`}
              >
                Αποθηκευμένη
              </button>
              <button
                type="button"
                onClick={() => setShippingMode("new")}
                className={`rounded px-3 py-1 ${
                  shippingMode === "new" ? "bg-primary text-primary-foreground" : "border"
                }`}
              >
                Νέα διεύθυνση
              </button>
            </div>
          )}
          {shippingMode === "saved" && savedAddresses.length > 0 ? (
            <SavedAddressList
              addresses={savedAddresses}
              selectedId={shippingId}
              onSelect={setShippingId}
            />
          ) : (
            <AddressFields
              value={shippingForm}
              onChange={setShippingForm}
              hideRecipientFields
            />
          )}
        </section>
      )}

      {/* Billing — coupled with shipping above so both address blocks
          sit together before the delivery method choice. */}
      <section className="border border-stone-taupe/20 rounded-sm bg-card p-4 space-y-3">
        <h2 className="font-semibold">
          {deliveryMethod === "store_pickup" ? "2. " : "3. "}Διεύθυνση χρέωσης
        </h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={billingSame}
            onChange={(e) => setBillingSame(e.target.checked)}
          />
          <span>
            {deliveryMethod === "store_pickup"
              ? "Δεν θέλω χωριστή διεύθυνση χρέωσης."
              : "Χρέωση ίδια με αποστολή."}
          </span>
        </label>
        {!billingSame && (
          <>
            {savedAddresses.length > 0 && (
              <div className="flex gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => setBillingMode("saved")}
                  className={`rounded px-3 py-1 ${
                    billingMode === "saved" ? "bg-primary text-primary-foreground" : "border"
                  }`}
                >
                  Αποθηκευμένη
                </button>
                <button
                  type="button"
                  onClick={() => setBillingMode("new")}
                  className={`rounded px-3 py-1 ${
                    billingMode === "new" ? "bg-primary text-primary-foreground" : "border"
                  }`}
                >
                  Νέα διεύθυνση
                </button>
              </div>
            )}
            {billingMode === "saved" && savedAddresses.length > 0 ? (
              <SavedAddressList
                addresses={savedAddresses}
                selectedId={billingId}
                onSelect={setBillingId}
              />
            ) : (
              <AddressFields value={billingForm} onChange={setBillingForm} />
            )}
          </>
        )}
      </section>
      </div>

      {/* Step 3 — delivery method */}
      <div className={step === 2 ? "" : "hidden"}>
      {/* Delivery method — sits after the address pair so the user has
          confirmed where it's going before we ask how it gets there. */}
      <section className="border border-stone-taupe/20 rounded-sm bg-card p-4 space-y-3">
        <h2 className="font-semibold">
          {deliveryMethod === "store_pickup" ? "3. " : "4. "}Τρόπος παράδοσης
        </h2>
        <div className="space-y-2">
          {DELIVERY_OPTIONS.map((o) => {
            // Hide delivery methods that no active carrier supports (per
            // ADR-8: customer never sees an option that can't be fulfilled).
            // store_pickup is always shown — it needs no carrier.
            const visibleMethods = availableDeliveryMethods(null, activeCarriers);
            if (!visibleMethods.includes(o.value)) return null;
            const isSelected =
              deliveryMethod === o.value && customMethodSlug === null;
            return (
              <label
                key={o.value}
                className={`flex items-center gap-2 rounded border p-2 cursor-pointer ${
                  isSelected ? "border-primary bg-primary/5" : ""
                }`}
              >
                <input
                  type="radio"
                  name="delivery_method"
                  value={o.value}
                  checked={isSelected}
                  onChange={() => {
                    setCustomMethodSlug(null);
                    setDeliveryMethod(o.value);
                  }}
                />
                <span className="text-sm">{o.label}</span>
              </label>
            );
          })}

          {/* Custom delivery methods — admin-defined relabel options. Each
              renders as a peer radio under the built-ins so the customer
              picks "Παράδοση με Van" the same way they'd pick "Παράδοση
              στο σπίτι". Selection forces deliveryMethod to the method's
              base_method (for compat logic) and locks carrier if scoped. */}
          {activeCustomMethods.map((m) => {
            const isSelected = customMethodSlug === m.slug;
            return (
              <label
                key={m.slug}
                className={`flex items-start gap-2 rounded border p-2 cursor-pointer ${
                  isSelected ? "border-primary bg-primary/5" : ""
                }`}
              >
                <input
                  type="radio"
                  name="delivery_method"
                  value={`custom:${m.slug}`}
                  checked={isSelected}
                  className="mt-1"
                  onChange={() => {
                    setCustomMethodSlug(m.slug);
                    setDeliveryMethod(m.base_method);
                    if (m.carrier_slug) {
                      setCarrier(m.carrier_slug as Carrier);
                    }
                  }}
                />
                <span className="text-sm">
                  <span className="font-medium">{m.display_name}</span>
                  {m.description && (
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      {m.description}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        {deliveryMethod !== "store_pickup" && (
          <label className="block text-sm">
            <span className="block text-xs text-muted-foreground mb-1">Μεταφορική</span>
            <select
              value={carrier}
              onChange={(e) => setCarrier(e.target.value as Carrier | "")}
              className="border rounded px-2 py-1 w-full"
            >
              <option value="">(επιλογή αργότερα)</option>
              {availableCarriers(deliveryMethod, activeCarriers).map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.display_name}
                </option>
              ))}
            </select>
          </label>
        )}
        {/* Phase 5 — remote-area banner. Shown when the carrier confirms the
            address is in a remote area AND has surface_inaccessibility ON
            (the previewFees response gates on the capability). The phrasing
            stays informational since the surcharge, if applicable, is
            already reflected in the live total below. */}
        {feePreview?.isInaccessible && deliveryMethod === "home_delivery" && (
          <div className="rounded border border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-medium mb-0.5">
              Η περιοχή σας θεωρείται απομακρυσμένη
              {feePreview.carrierDisplayName
                ? ` από την ${feePreview.carrierDisplayName}`
                : ""}
              .
            </p>
            <p className="text-xs">
              Μπορεί να ισχύει επιπλέον χρέωση — δείτε το ποσό στη σύνοψη πιο
              κάτω. Αν δεν σας εξυπηρετεί, δοκιμάστε άλλη μεταφορική ή
              παραλαβή από κατάστημα.
            </p>
          </div>
        )}

        {/* Phase 7 — pickup point picker. Only rendered for locker / branch
            delivery methods; uses the recipient zipcode for proximity sort.
            The selection threads through to placeOrder via pickupSelection
            state. */}
        {(deliveryMethod === "delivery_station_pickup" ||
          deliveryMethod === "carrier_pickup") && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Σημείο παραλαβής</p>
            <LocationPicker
              carrier={carrier === "" ? null : carrier}
              carrierDisplayName={
                carrier === ""
                  ? null
                  : (activeCarriers.find((c) => c.slug === carrier)?.display_name ?? null)
              }
              recipientZip={previewZip}
              recipientCountry={previewCountry}
              deliveryMethod={deliveryMethod}
              value={pickupSelection}
              onSelect={setPickupSelection}
            />
          </div>
        )}
      </section>
      </div>

      {/* Step 4 — payment + notes */}
      <div className={step === 3 ? "" : "hidden"}>
      {/* Payment */}
      <section className="border border-stone-taupe/20 rounded-sm bg-card p-4 space-y-3">
        <h2 className="font-semibold">
          {deliveryMethod === "store_pickup" ? "4. " : "5. "}Τρόπος πληρωμής
        </h2>
        <div className="space-y-2">
          {PAYMENT_OPTIONS.map((o) => {
            const disabled = !availablePaymentMethods(
              deliveryMethod,
              carrier === "" ? null : (carrier as Carrier)
            ).includes(o.value);
            return (
              <label
                key={o.value}
                className={`flex items-start gap-2 rounded border p-2 cursor-pointer ${
                  paymentMethod === o.value ? "border-primary bg-primary/5" : ""
                } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
              >
                <input
                  type="radio"
                  name="payment_method"
                  value={o.value}
                  checked={paymentMethod === o.value}
                  onChange={() => !disabled && setPaymentMethod(o.value)}
                  disabled={disabled}
                  className="mt-1"
                />
                <div className="text-sm">
                  <p className="font-medium">{o.label}</p>
                  <p className="text-xs text-muted-foreground">{o.description}</p>
                </div>
              </label>
            );
          })}
        </div>
      </section>

      {/* Notes */}
      <section className="border border-stone-taupe/20 rounded-sm bg-card p-4">
        <label className="block text-sm">
          <span className="block text-xs text-muted-foreground mb-1">
            Σημειώσεις (προαιρετικό)
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="border rounded px-2 py-1 w-full"
          />
        </label>
      </section>
      </div>

      {/* Step 5 — review + place order */}
      <div className={step === 4 ? "" : "hidden"}>
      {/* Summary + place */}
      <section className="border border-stone-taupe/20 rounded-sm bg-warm-sand/30 p-5 space-y-3">
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Είδη</dt>
          <dd className="text-right">{itemCount}</dd>
          <dt className="text-muted-foreground">Υποσύνολο</dt>
          <dd className="text-right">
            {subtotal.toFixed(2)} {currency}
          </dd>
          {feePreview && feePreview.breakdown.length > 0 ? (
            feePreview.breakdown
              .slice()
              .sort((a, b) => a.display_order - b.display_order)
              .map((entry) => (
                <div key={entry.category_slug} className="contents">
                  <dt className="text-muted-foreground">{entry.label}</dt>
                  <dd className="text-right">
                    {entry.charged.toFixed(2)} {currency}
                  </dd>
                </div>
              ))
          ) : feePreviewLoading ? (
            <>
              <dt className="text-muted-foreground">Χρεώσεις</dt>
              <dd className="text-right text-muted-foreground">υπολογισμός…</dd>
            </>
          ) : null}
          <dt className="font-serif font-bold text-ink text-base">Σύνολο τώρα</dt>
          <dd className="text-right font-mono font-bold text-ink">
            {total.toFixed(2)} {currency}
          </dd>
        </dl>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          className="w-full rounded-sm bg-primary text-primary-foreground py-3 text-sm font-medium uppercase tracking-wider hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {isPending
            ? "Επεξεργασία..."
            : paymentMethod === "stripe"
              ? "Συνέχεια στην πληρωμή"
              : "Υποβολή παραγγελίας"}
        </button>
        <p className="text-xs text-muted-foreground text-center">
          Με την υποβολή αποδέχεστε τους Όρους Χρήσης και την Πολιτική Απορρήτου.
        </p>
      </section>
      </div>

      {/* Step navigation */}
      <div className="flex items-center justify-between gap-3">
        {step > 0 ? (
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-ink hover:text-terracotta transition-colors"
          >
            ← Πίσω
          </button>
        ) : (
          <span />
        )}
        {step < STEP_LABELS.length - 1 && (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(STEP_LABELS.length - 1, s + 1))}
            className="inline-flex items-center justify-center gap-2 rounded-sm bg-primary text-primary-foreground h-11 px-6 text-sm font-medium uppercase tracking-wider hover:bg-primary/90 transition-colors"
          >
            Επόμενο →
          </button>
        )}
      </div>
    </div>
  );
}

const STEP_LABELS = ["Στοιχεία", "Διεύθυνση", "Παράδοση", "Πληρωμή", "Ολοκλήρωση"];

/** Typeform-style progress header — current step title + a progress bar. */
function CheckoutSteps({ current, labels }: { current: number; labels: string[] }) {
  return (
    <div className="mb-2">
      <div className="flex items-baseline justify-between mb-2">
        <span className="font-serif text-xl font-bold text-ink">{labels[current]}</span>
        <span className="text-xs font-mono text-stone-taupe">
          Βήμα {current + 1} / {labels.length}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-stone-taupe/20 overflow-hidden">
        <div
          className="h-full bg-terracotta transition-all duration-300"
          style={{ width: `${((current + 1) / labels.length) * 100}%` }}
        />
      </div>
    </div>
  );
}

function mapAddressFormToJson(a: AddressForm) {
  return {
    first_name: a.first_name || undefined,
    last_name: a.last_name || undefined,
    street: a.street || undefined,
    address_line2: a.address_line2 || undefined,
    city: a.city || undefined,
    state: a.state || undefined,
    postal_code: a.postal_code || undefined,
    country_code: a.country_code || undefined,
    phone: a.phone || undefined,
  };
}

function SavedAddressList({
  addresses,
  selectedId,
  onSelect,
}: {
  addresses: Address[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="space-y-2">
      {addresses.map((a) => (
        <li
          key={a.id}
          onClick={() => onSelect(a.id)}
          className={`border rounded p-2 cursor-pointer text-sm ${
            selectedId === a.id ? "border-primary bg-primary/5" : "hover:bg-muted/30"
          }`}
        >
          <p className="font-medium">
            {a.label ?? `${a.first_name} ${a.last_name}`}
            {a.is_default_shipping && (
              <span className="ml-2 text-xs rounded bg-muted px-1 py-0.5 text-muted-foreground">
                default ship
              </span>
            )}
          </p>
          <p className="text-muted-foreground text-xs">
            {a.address_line1}
            {a.address_line2 ? `, ${a.address_line2}` : ""}, {a.postal_code} {a.city},{" "}
            {a.country_code}
          </p>
        </li>
      ))}
    </ul>
  );
}

function AddressFields({
  value,
  onChange,
  hideRecipientFields = false,
}: {
  value: AddressForm;
  onChange: (a: AddressForm) => void;
  /**
   * When true, hide the first_name/last_name/phone inputs because the
   * recipient mirrors the buyer (the "Ίδια στοιχεία" toggle on the parent).
   * The form still collects street/city/postal_code/etc. independently.
   */
  hideRecipientFields?: boolean;
}) {
  const set = (patch: Partial<AddressForm>) => onChange({ ...value, ...patch });
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
      {!hideRecipientFields && (
        <>
          <input
            value={value.first_name}
            onChange={(e) => set({ first_name: e.target.value })}
            placeholder="Όνομα"
            className="border rounded px-2 py-1"
          />
          <input
            value={value.last_name}
            onChange={(e) => set({ last_name: e.target.value })}
            placeholder="Επώνυμο"
            className="border rounded px-2 py-1"
          />
          <input
            value={value.phone}
            onChange={(e) => set({ phone: e.target.value })}
            placeholder="Τηλέφωνο"
            className="border rounded px-2 py-1 md:col-span-2"
          />
        </>
      )}
      <input
        value={value.street}
        onChange={(e) => set({ street: e.target.value })}
        onBlur={() => set({ street: normalizeAddressLine(value.street) })}
        placeholder="Οδός και αριθμός"
        className="border rounded px-2 py-1 md:col-span-2"
      />
      <input
        value={value.address_line2}
        onChange={(e) => set({ address_line2: e.target.value })}
        onBlur={() => set({ address_line2: normalizeAddressLine(value.address_line2) })}
        placeholder="Όροφος / προσθήκη (προαιρετικό)"
        className="border rounded px-2 py-1 md:col-span-2"
      />
      <input
        value={value.city}
        onChange={(e) => set({ city: e.target.value })}
        onBlur={() => set({ city: normalizeAddressLine(value.city) })}
        placeholder="Πόλη"
        className="border rounded px-2 py-1"
      />
      <input
        value={value.postal_code}
        onChange={(e) => {
          const cap = getZipMaxLength(value.country_code);
          // Strip everything except digits + letters so user can't sneak
          // spaces or junk in via paste. Then apply the length cap.
          const raw = e.target.value.replace(/[^A-Za-z0-9]/g, "");
          const next = cap !== null ? raw.slice(0, cap) : raw;
          set({ postal_code: next });
        }}
        onBlur={() => set({ postal_code: normalizeZip(value.postal_code, value.country_code) })}
        inputMode={getZipMaxLength(value.country_code) !== null ? "numeric" : "text"}
        pattern={getZipMaxLength(value.country_code) !== null ? "[0-9]*" : undefined}
        maxLength={getZipMaxLength(value.country_code) ?? undefined}
        placeholder="Τ.Κ."
        className="border rounded px-2 py-1"
      />
      <select
        value={value.country_code}
        onChange={(e) => set({ country_code: e.target.value })}
        className="border rounded px-2 py-1 bg-background"
        aria-label="Χώρα"
      >
        {SUPPORTED_COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}
