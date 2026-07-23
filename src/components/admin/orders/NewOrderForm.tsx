"use client";

import PhoneCountryInput from "@/components/features/forms/PhoneCountryInput";
import {
  normalizeName,
  normalizeZip,
  normalizeAddressLine,
  isValidZip,
  parsePhoneInput,
  DEFAULT_PHONE_COUNTRY,
  getZipMaxLength,
} from "@/lib/forms/normalize";
import { SUPPORTED_COUNTRIES } from "@/lib/forms/countries";
import type { CountryCode } from "libphonenumber-js";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createOrder } from "@/actions/orders/createOrder";
import {
  previewAdminOrderFees,
  type AdminFeePreviewResult,
} from "@/actions/orders/previewAdminOrderFees";
import { formatCurrency } from "@/lib/multi-currency/formatCurrency";
import {
  Users,
  ShoppingBag,
  Truck,
  Tag,
  Info,
  ClipboardList,
} from "@/components/admin/common/icons";
import {
  searchAdminVariants,
  type AdminVariantResult,
} from "@/actions/orders/searchAdminVariants";
import {
  searchCustomers,
  type CustomerResult,
} from "@/actions/orders/searchCustomers";
import { matchOrCreateCustomer } from "@/actions/customers/matchOrCreateCustomer";
import type { Customer } from "@/types/customer";
import type { DeliveryMethod, Carrier } from "@/types/order-history";
import {
  MANUAL_PAYMENT_METHODS,
  DELIVERY_METHODS as DELIVERY_METHODS_CFG,
  CARRIERS as CARRIERS_CFG,
  ORDER_SOURCES,
  SUPPORTED_COUNTRIES as STOREFRONT_COUNTRIES,
  DEFAULT_COUNTRY as STOREFRONT_DEFAULT_COUNTRY,
  type ManualPaymentMethod,
  type ManualOrderSource,
} from "@/config/storefront";

interface LineItem {
  variant_id: string;
  product_name: string;
  variant_label: string | null;
  sku: string;
  quantity: number;
  unit_price: number;
  quantity_available: number;
}

/**
 * A customer attached to this draft order. Either resolved from an existing
 * `customers` row (search → pick) or freshly entered (will be created on
 * submit unless the strict-match prompt routes us to an existing row).
 */
type CustomerSelection =
  | {
      kind: "resolved";
      customer_id: string;
      email: string | null;
      first_name: string | null;
      last_name: string | null;
      phone: string | null;
    }
  | null;

interface AddressForm {
  first_name: string;
  last_name: string;
  street: string;
  city: string;
  postal_code: string;
  country_code: string;
  phone: string;
  /** ISO2 country for the phone. Only meaningful when phone is user-typed
   *  (i.e. recipientSameAsCustomer = false). */
  phoneCountry: CountryCode;
  notes: string;
}

const EMPTY_ADDRESS: AddressForm = {
  first_name: "",
  last_name: "",
  phoneCountry: DEFAULT_PHONE_COUNTRY,
  street: "",
  city: "",
  postal_code: "",
  country_code: STOREFRONT_DEFAULT_COUNTRY,
  phone: "",
  notes: "",
};

// Business constants imported from @/config/storefront — single source of truth.
const PAYMENT_METHODS = MANUAL_PAYMENT_METHODS;
const DELIVERY_METHODS = DELIVERY_METHODS_CFG;
const CARRIERS = CARRIERS_CFG;
const SOURCES = ORDER_SOURCES;

function addressNonEmpty(a: AddressForm): boolean {
  return Boolean(a.street || a.city || a.postal_code || a.first_name || a.last_name);
}

export default function NewOrderForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Customer — resolved customer record (post-search or post-create).
  const [customer, setCustomer] = useState<CustomerSelection>(null);
  // Tab choice. "existing" searches the customers table; "new_customer"
  // captures fields that go through matchOrCreateCustomer on submit.
  const [customerMode, setCustomerMode] = useState<"existing" | "new_customer">("existing");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerResult[]>([]);
  const [newCustEmail, setNewCustEmail] = useState("");
  const [newCustPhone, setNewCustPhone] = useState("");
  const [newCustFirstName, setNewCustFirstName] = useState("");
  const [newCustLastName, setNewCustLastName] = useState("");

  /**
   * When matchOrCreateCustomer reports a strict (email AND phone) match, we
   * stash it here and surface the inline "Είστε εσείς?" prompt. Submit is
   * paused until the admin answers; clicking Yes accepts, No forces a fresh
   * customer on next click.
   */
  const [matchPrompt, setMatchPrompt] = useState<Customer | null>(null);
  const [forceNewCustomer, setForceNewCustomer] = useState(false);

  // Items
  const [items, setItems] = useState<LineItem[]>([]);
  const [variantQuery, setVariantQuery] = useState("");
  const [variantResults, setVariantResults] = useState<AdminVariantResult[]>([]);
  const [variantSearchError, setVariantSearchError] = useState<string | null>(null);
  const [variantHasSearched, setVariantHasSearched] = useState(false);

  // Customer search error surface
  const [customerSearchError, setCustomerSearchError] = useState<string | null>(null);
  const [customerHasSearched, setCustomerHasSearched] = useState(false);

  // Axes
  const [paymentMethod, setPaymentMethod] = useState<ManualPaymentMethod>("cod");
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>("home_delivery");
  const [carrier, setCarrier] = useState<Carrier | "">("acs");
  const [source, setSource] = useState<ManualOrderSource>("phone");

  // Money
  const [discountAmount, setDiscountAmount] = useState("0");
  const [shippingAmount, setShippingAmount] = useState("0");
  const [taxAmount, setTaxAmount] = useState("0");

  // Addresses
  const [shippingAddress, setShippingAddress] = useState<AddressForm>(EMPTY_ADDRESS);
  const [billingAddress, setBillingAddress] = useState<AddressForm>(EMPTY_ADDRESS);
  const [billingSameAsShipping, setBillingSameAsShipping] = useState(true);
  // Mirrors the customer-facing "Ίδια στοιχεία παραλήπτη με αγοραστή"
  // toggle: when on, the recipient identity (first/last/phone) on the
  // shipping address is taken from the selected customer record at submit
  // time rather than typed separately. The "buyer" here is the chosen
  // customer (admin already resolved them above).
  const [recipientSameAsCustomer, setRecipientSameAsCustomer] = useState(true);

  // Notes
  const [notes, setNotes] = useState("");

  // Live fee preview — populated by a debounced call to
  // previewAdminOrderFees whenever any of the inputs that influence
  // pricing change (items, carrier, delivery method, payment method,
  // destination). Stays `null` until the first successful resolution.
  const [feePreview, setFeePreview] = useState<AdminFeePreviewResult | null>(
    null
  );
  const [feePreviewLoading, setFeePreviewLoading] = useState(false);
  const [feePreviewError, setFeePreviewError] = useState<string | null>(null);

  const subtotal = useMemo(
    () => Math.round(items.reduce((s, l) => s + l.unit_price * l.quantity, 0) * 100) / 100,
    [items]
  );
  // Resolved shipping fee (from breakdown) — used in the total
  // calculation INSTEAD of the manual `shippingAmount` field. The
  // input is kept for legacy fall-back display only; the resolver is
  // the source of truth.
  const resolvedShipping = useMemo(() => {
    if (!feePreview) return 0;
    const shippingFee = feePreview.fees_breakdown.find(
      (f) => f.category_slug === "shipping"
    );
    return shippingFee?.charged ?? 0;
  }, [feePreview]);
  // COD/handling surcharge — surfaced separately so the admin can see
  // it broken out (rather than rolled into a single "shipping" line).
  const resolvedCodSurcharge = useMemo(() => {
    if (!feePreview || paymentMethod !== "cod") return 0;
    const codFee = feePreview.fees_breakdown.find(
      (f) => f.category_slug === "cod_handling"
    );
    return codFee?.charged ?? 0;
  }, [feePreview, paymentMethod]);

  // ─── Debounced fee resolution ────────────────────────────────────
  // Re-runs the resolver whenever any pricing-relevant input changes.
  // 300ms debounce: enough that a user typing in the zipcode doesn't
  // fire 5 server calls, but short enough that the UI feels live as
  // they tab from field to field. AbortController guards against
  // out-of-order results (the older call's response landing AFTER
  // the newer one).
  useEffect(() => {
    if (items.length === 0) {
      setFeePreview(null);
      return;
    }
    const handle = setTimeout(() => {
      setFeePreviewLoading(true);
      setFeePreviewError(null);
      const carrierArg: Carrier | null =
        deliveryMethod === "store_pickup" || !carrier
          ? null
          : (carrier as Carrier);
      previewAdminOrderFees({
        payment_method: paymentMethod,
        delivery_method: deliveryMethod,
        carrier: carrierArg,
        items: items.map((i) => ({
          variant_id: i.variant_id,
          quantity: i.quantity,
        })),
        recipient_zipcode: shippingAddress.postal_code || undefined,
        recipient_country: shippingAddress.country_code || undefined,
      })
        .then((r) => {
          if (r.success) {
            setFeePreview(r.data);
          } else {
            setFeePreviewError(r.error);
          }
        })
        .finally(() => setFeePreviewLoading(false));
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    // The items array reference changes on every state update, so we
    // hash the price-relevant fields instead of depending on the
    // array directly — saves a server call on identity-only changes.
    JSON.stringify(items.map((i) => ({ v: i.variant_id, q: i.quantity }))),
    paymentMethod,
    deliveryMethod,
    carrier,
    shippingAddress.postal_code,
    shippingAddress.country_code,
  ]);

  const total = useMemo(
    () =>
      Math.round(
        (subtotal -
          (Number(discountAmount) || 0) +
          resolvedShipping +
          resolvedCodSurcharge +
          (Number(taxAmount) || 0)) * 100
      ) / 100,
    [subtotal, discountAmount, resolvedShipping, resolvedCodSurcharge, taxAmount]
  );

  function searchCust() {
    setCustomerSearchError(null);
    if (customerQuery.trim().length < 2) {
      setCustomerResults([]);
      setCustomerSearchError("Πληκτρολογήστε τουλάχιστον 2 χαρακτήρες.");
      return;
    }
    setCustomerHasSearched(true);
    startTransition(async () => {
      const r = await searchCustomers({ q: customerQuery.trim() });
      if (!r.success) {
        setCustomerSearchError(r.error);
        setCustomerResults([]);
        return;
      }
      setCustomerResults(r.data);
    });
  }

  function searchVar() {
    setVariantSearchError(null);
    setVariantHasSearched(true);
    startTransition(async () => {
      const r = await searchAdminVariants({
        q: variantQuery.trim() || undefined,
        excludeIds: items.map((i) => i.variant_id),
      });
      if (!r.success) {
        setVariantSearchError(r.error);
        setVariantResults([]);
        return;
      }
      setVariantResults(r.data);
    });
  }

  function pickCustomer(c: CustomerResult) {
    setCustomer({
      kind: "resolved",
      customer_id: c.customer_id,
      email: c.email,
      first_name: c.first_name,
      last_name: c.last_name,
      phone: c.phone,
    });
    setCustomerResults([]);
    setCustomerQuery(c.email ?? "");
    setCustomerHasSearched(false);
    setCustomerSearchError(null);
  }

  function clearCustomer() {
    setCustomer(null);
    setCustomerQuery("");
    setNewCustEmail("");
    setNewCustPhone("");
    setNewCustFirstName("");
    setNewCustLastName("");
    setMatchPrompt(null);
    setForceNewCustomer(false);
  }

  function addVariant(v: AdminVariantResult) {
    setItems((prev) => [
      ...prev,
      {
        variant_id: v.variant_id,
        product_name: v.product_name,
        variant_label: v.variant_label,
        sku: v.sku,
        quantity: 1,
        unit_price: v.price,
        quantity_available: v.quantity_available,
      },
    ]);
    const remaining = variantResults.filter((x) => x.variant_id !== v.variant_id);
    setVariantResults(remaining);
    if (remaining.length === 0) {
      // Removing the last result would otherwise trigger the "no results"
      // empty-state spuriously. Reset the search flag instead.
      setVariantHasSearched(false);
    }
  }

  function removeItem(variantId: string) {
    setItems((prev) => prev.filter((i) => i.variant_id !== variantId));
  }

  function updateItem(variantId: string, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((i) => (i.variant_id === variantId ? { ...i, ...patch } : i)));
  }

  function buildOrderPayload(customerId: string, asDraft: boolean) {
    if (items.length === 0) {
      throw new Error("Προσθέστε τουλάχιστον ένα προϊόν.");
    }
    const carrierToSend: Carrier | null =
      deliveryMethod === "store_pickup" ? null : carrier === "" ? null : carrier;

    // Mirror the resolved customer's first/last/phone into the shipping
    // address when "Ίδια στοιχεία" is ticked. The user typed only the
    // physical-location fields; the recipient identity comes from the
    // customer record. When unticked, the typed values stand and we
    // convert the phone to E.164 (using the dropdown's country).
    const shippingPhoneE164 = recipientSameAsCustomer
      ? customer?.phone ?? ""
      : parsePhoneInput(shippingAddress.phone, shippingAddress.phoneCountry).e164 ||
        shippingAddress.phone;

    const shippingToSend: AddressForm = recipientSameAsCustomer
      ? {
          ...shippingAddress,
          first_name: customer?.first_name ?? shippingAddress.first_name ?? "",
          last_name: customer?.last_name ?? shippingAddress.last_name ?? "",
          phone: shippingPhoneE164,
          // Idempotent normalization of the physical-location fields.
          street: normalizeAddressLine(shippingAddress.street),
          city: normalizeAddressLine(shippingAddress.city),
          postal_code: normalizeZip(shippingAddress.postal_code, shippingAddress.country_code),
        }
      : {
          ...shippingAddress,
          first_name: normalizeName(shippingAddress.first_name),
          last_name: normalizeName(shippingAddress.last_name),
          phone: shippingPhoneE164,
          street: normalizeAddressLine(shippingAddress.street),
          city: normalizeAddressLine(shippingAddress.city),
          postal_code: normalizeZip(shippingAddress.postal_code, shippingAddress.country_code),
        };

    const billing = billingSameAsShipping ? shippingToSend : billingAddress;

    return {
      customer_id: customerId,
      payment_method: paymentMethod,
      delivery_method: deliveryMethod,
      carrier: carrierToSend,
      source,
      currency: "EUR",
      discount_amount: Number(discountAmount) || 0,
      shipping_amount: Number(shippingAmount) || 0,
      tax_amount: Number(taxAmount) || 0,
      items: items.map((i) => ({
        variant_id: i.variant_id,
        quantity: i.quantity,
        unit_price: i.unit_price,
      })),
      shipping_address: addressNonEmpty(shippingToSend) ? shippingToSend : undefined,
      billing_address: addressNonEmpty(billing) ? billing : undefined,
      notes: notes.trim() || undefined,
      as_draft: asDraft,
    };
  }

  /**
   * Resolve a customer_id for the current form state, surfacing the
   * "Είστε εσείς?" prompt if the strict (email AND phone) dedup hits.
   *
   * - "existing" mode requires the admin to have already picked a result.
   * - "new_customer" mode goes through matchOrCreateCustomer. If a match
   *   needs confirmation, we set `matchPrompt` and return null — the
   *   caller pauses and waits for the admin to click Yes/No.
   */
  async function resolveCustomerId(): Promise<string | null> {
    if (customerMode === "existing") {
      if (customer?.kind !== "resolved") {
        throw new Error("Επιλέξτε υπάρχοντα πελάτη.");
      }
      return customer.customer_id;
    }
    // new_customer mode
    const email = newCustEmail.trim();
    const phone = newCustPhone.trim();
    const first = newCustFirstName.trim();
    const last = newCustLastName.trim();
    if (!email && !phone) {
      throw new Error("Συμπληρώστε email ή/και τηλέφωνο.");
    }
    const r = await matchOrCreateCustomer({
      email: email || undefined,
      phone: phone || undefined,
      first_name: first || undefined,
      last_name: last || undefined,
      source: source === "in_store" ? "in_store" : "phone",
      prompt_on_match: true,
      force_new: forceNewCustomer,
    });
    if (!r.success) {
      throw new Error(r.error);
    }
    if (r.data.outcome === "matched" && r.data.needs_confirmation) {
      // Pause submission and prompt the admin.
      setMatchPrompt(r.data.customer);
      return null;
    }
    // matched-and-accepted or created — both give us a usable customer id.
    return r.data.customer.id;
  }

  function submit(asDraft: boolean) {
    setError(null);
    setMatchPrompt(null);
    startTransition(async () => {
      let customerId: string | null;
      try {
        customerId = await resolveCustomerId();
      } catch (e) {
        setError((e as Error).message);
        return;
      }
      if (customerId === null) {
        // Awaiting "Είστε εσείς?" confirmation.
        return;
      }
      let payload: ReturnType<typeof buildOrderPayload>;
      try {
        payload = buildOrderPayload(customerId, asDraft);
      } catch (e) {
        setError((e as Error).message);
        return;
      }
      const r = await createOrder(payload);
      if (!r.success) {
        setError(r.error);
        return;
      }
      router.push(`/admin/orders/${r.data.order_id}`);
    });
  }

  /** "Είστε εσείς?" → Yes: accept the match and proceed with the same submit click. */
  function acceptMatch(asDraft: boolean) {
    if (!matchPrompt) return;
    const matchedCustomerId = matchPrompt.id;
    setMatchPrompt(null);
    setError(null);
    startTransition(async () => {
      let payload: ReturnType<typeof buildOrderPayload>;
      try {
        payload = buildOrderPayload(matchedCustomerId, asDraft);
      } catch (e) {
        setError((e as Error).message);
        return;
      }
      const r = await createOrder(payload);
      if (!r.success) {
        setError(r.error);
        return;
      }
      router.push(`/admin/orders/${r.data.order_id}`);
    });
  }

  /** "Είστε εσείς?" → No: force a fresh customer on the next click. */
  function rejectMatch() {
    setMatchPrompt(null);
    setForceNewCustomer(true);
  }

  return (
    <div className="space-y-5">
      {/* ═══ Πελάτης ═══ */}
      <section className="cms-card-section space-y-4">
        <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
              <Users className="w-4 h-4" />
              Πελάτης
            </h2>
            <p className="text-sm text-foreground/70 mt-1.5">
              Βρείτε υπάρχοντα πελάτη ή δημιουργήστε νέο. Αν τα στοιχεία ενός
              νέου πελάτη ταιριάζουν με υπάρχοντα, θα ζητηθεί επιβεβαίωση.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setCustomerMode("existing");
                clearCustomer();
              }}
              className={
                customerMode === "existing"
                  ? "btn btn-primary btn-sm"
                  : "btn btn-secondary btn-sm"
              }
            >
              Υπάρχων πελάτης
            </button>
            <button
              type="button"
              onClick={() => {
                setCustomerMode("new_customer");
                clearCustomer();
              }}
              className={
                customerMode === "new_customer"
                  ? "btn btn-primary btn-sm"
                  : "btn btn-secondary btn-sm"
              }
            >
              Νέος πελάτης
            </button>
          </div>
        </header>

        {customerMode === "existing" ? (
          <div className="space-y-3">
            {customer?.kind === "resolved" ? (
              <div className="flex items-center justify-between gap-3 rounded-md border border-foreground/15 bg-muted/30 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    {customer.email ?? "(χωρίς email)"}
                  </p>
                  <p className="text-sm text-muted-foreground truncate">
                    {[customer.first_name, customer.last_name]
                      .filter(Boolean)
                      .join(" ") || "—"}
                    {customer.phone && ` · ${customer.phone}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={clearCustomer}
                  className="btn btn-secondary btn-sm shrink-0"
                >
                  Αλλαγή
                </button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <input
                    value={customerQuery}
                    onChange={(e) => setCustomerQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        searchCust();
                      }
                    }}
                    placeholder="Αναζήτηση email, όνομα ή τηλέφωνο…"
                    className="cms-input flex-1"
                  />
                  <button
                    type="button"
                    onClick={searchCust}
                    disabled={isPending}
                    className="btn btn-secondary btn-md"
                  >
                    Αναζήτηση
                  </button>
                </div>
                {customerSearchError && (
                  <p className="text-xs text-destructive">
                    {customerSearchError}
                  </p>
                )}
                {customerHasSearched &&
                  !customerSearchError &&
                  customerResults.length === 0 &&
                  !isPending && (
                    <p className="text-xs text-muted-foreground">
                      Δεν βρέθηκαν πελάτες.
                    </p>
                  )}
                {customerResults.length > 0 && (
                  <ul className="rounded-md border border-foreground/15 divide-y divide-foreground/10 text-sm max-h-48 overflow-y-auto bg-background">
                    {customerResults.map((c) => (
                      <li
                        key={c.customer_id}
                        onClick={() => pickCustomer(c)}
                        className="px-3 py-2 cursor-pointer hover:bg-muted/40 transition-colors"
                      >
                        <p className="font-medium">
                          {c.email ?? "(χωρίς email)"}
                          {!c.has_auth_account && (
                            <span className="ml-2 cms-badge cms-badge-muted text-[10px]">
                              offline
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[c.first_name, c.last_name]
                            .filter(Boolean)
                            .join(" ") || "—"}
                          {c.phone && ` · ${c.phone}`}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Inputs use the same normalize helpers as the customer
                checkout: name capitalization (normalizeName), phone
                formatting (parsePhoneInput), email lowercase+trim.
                Applied on BLUR so admins can type naturally and the
                clean-up only fires when they leave the field. This is
                the strict-formatting + restrictions you wanted to
                prevent garbage entries from creating phantom
                customers. */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <label className="block">
                <span className="block text-xs font-medium mb-1 text-muted-foreground">
                  Όνομα
                </span>
                <input
                  value={newCustFirstName}
                  onChange={(e) => {
                    setNewCustFirstName(e.target.value);
                    setForceNewCustomer(false);
                  }}
                  onBlur={(e) =>
                    setNewCustFirstName(normalizeName(e.target.value))
                  }
                  maxLength={120}
                  autoCapitalize="words"
                  className="cms-input"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium mb-1 text-muted-foreground">
                  Επώνυμο
                </span>
                <input
                  value={newCustLastName}
                  onChange={(e) => {
                    setNewCustLastName(e.target.value);
                    setForceNewCustomer(false);
                  }}
                  onBlur={(e) =>
                    setNewCustLastName(normalizeName(e.target.value))
                  }
                  maxLength={120}
                  autoCapitalize="words"
                  className="cms-input"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium mb-1 text-muted-foreground">
                  Email
                </span>
                <input
                  type="email"
                  value={newCustEmail}
                  onChange={(e) => {
                    setNewCustEmail(e.target.value);
                    setForceNewCustomer(false);
                    setMatchPrompt(null);
                  }}
                  onBlur={(e) =>
                    setNewCustEmail(e.target.value.trim().toLowerCase())
                  }
                  maxLength={200}
                  inputMode="email"
                  autoComplete="email"
                  className="cms-input"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium mb-1 text-muted-foreground">
                  Τηλέφωνο
                </span>
                <input
                  value={newCustPhone}
                  onChange={(e) => {
                    setNewCustPhone(e.target.value);
                    setForceNewCustomer(false);
                    setMatchPrompt(null);
                  }}
                  onBlur={(e) => {
                    // parsePhoneInput returns the canonical +30XXX form
                    // when it recognizes the number; otherwise we keep
                    // what the admin typed (stripped of obvious noise).
                    const parsed = parsePhoneInput(
                      e.target.value,
                      DEFAULT_PHONE_COUNTRY
                    );
                    if (parsed.valid && parsed.e164) {
                      setNewCustPhone(parsed.e164);
                    } else {
                      // Strip whitespace/parentheses/dashes but leave
                      // the rest for the admin to fix.
                      setNewCustPhone(
                        e.target.value.replace(/[^\d+]/g, "")
                      );
                    }
                  }}
                  inputMode="tel"
                  maxLength={40}
                  className="cms-input"
                />
              </label>
            </div>

            {matchPrompt && (
              <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2">
                <p className="text-sm font-medium">
                  Είναι αυτός ο ίδιος πελάτης;
                </p>
                <p className="text-sm">
                  {[matchPrompt.first_name, matchPrompt.last_name]
                    .filter(Boolean)
                    .join(" ") || "(χωρίς όνομα)"}
                  {matchPrompt.email && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {matchPrompt.email}
                    </span>
                  )}
                  {matchPrompt.phone && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {matchPrompt.phone}
                    </span>
                  )}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => acceptMatch(false)}
                    disabled={isPending}
                    className="btn btn-primary btn-sm"
                  >
                    Ναι — Επιβεβαίωση παραγγελίας
                  </button>
                  <button
                    type="button"
                    onClick={() => acceptMatch(true)}
                    disabled={isPending}
                    className="btn btn-secondary btn-sm"
                  >
                    Ναι — Αποθήκευση ως πρόχειρο
                  </button>
                  <button
                    type="button"
                    onClick={rejectMatch}
                    disabled={isPending}
                    className="btn btn-secondary btn-sm"
                  >
                    Όχι, διαφορετικός πελάτης
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ═══ Προϊόντα ═══ */}
      <section className="cms-card-section space-y-4">
        <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
          <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
            <ShoppingBag className="w-4 h-4" />
            Προϊόντα
          </h2>
          <p className="text-sm text-foreground/70 mt-1.5">
            Αναζητήστε με SKU ή όνομα — επιλέξτε παραλλαγή για να την προσθέσετε στη παραγγελία.
          </p>
        </header>

        <div className="flex gap-2">
          <input
            value={variantQuery}
            onChange={(e) => setVariantQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                searchVar();
              }
            }}
            placeholder="Αναζήτηση SKU ή όνομα προϊόντος…"
            className="cms-input flex-1"
          />
          <button
            type="button"
            onClick={searchVar}
            disabled={isPending}
            className="btn btn-secondary btn-md"
          >
            Αναζήτηση
          </button>
        </div>

        {variantSearchError && (
          <p className="text-xs text-destructive">{variantSearchError}</p>
        )}
        {variantHasSearched &&
          !variantSearchError &&
          variantResults.length === 0 &&
          !isPending && (
            <p className="text-xs text-muted-foreground">
              Δεν βρέθηκαν προϊόντα.
            </p>
          )}
        {variantResults.length > 0 && (
          <ul className="rounded-md border border-foreground/15 divide-y divide-foreground/10 text-sm max-h-56 overflow-y-auto bg-background">
            {variantResults.map((v) => (
              <li
                key={v.variant_id}
                onClick={() => addVariant(v)}
                className="px-3 py-2 cursor-pointer hover:bg-muted/40 transition-colors flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="truncate">
                    {v.product_name}
                    {v.variant_label && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {v.variant_label}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono truncate">
                    {v.sku} · στοκ {v.quantity_available} · €
                    {v.price.toFixed(2)}
                  </p>
                </div>
                <span className="cms-badge cms-badge-neutral text-[10px] shrink-0">
                  + Προσθήκη
                </span>
              </li>
            ))}
          </ul>
        )}

        {items.length === 0 ? (
          <p className="cms-empty">Καμία γραμμή ακόμη.</p>
        ) : (
          <div className="rounded-lg overflow-hidden bg-background shadow-[0_1px_2px_rgba(0,0,0,0.05)] border border-foreground/10">
            <table className="cms-table">
              <thead>
                <tr>
                  <th className="text-left">Προϊόν</th>
                  <th>Στοκ</th>
                  <th>Ποσότητα</th>
                  <th>Τιμή</th>
                  <th>Σύνολο</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const overStock = i.quantity > i.quantity_available;
                  return (
                    <tr key={i.variant_id}>
                      <td className="text-left">
                        <p className="font-medium">
                          {i.product_name}
                          {i.variant_label && (
                            <span className="text-muted-foreground">
                              {" "}
                              · {i.variant_label}
                            </span>
                          )}
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground">
                          {i.sku}
                        </p>
                      </td>
                      <td
                        className={`tabular-nums ${
                          overStock ? "text-destructive font-semibold" : ""
                        }`}
                      >
                        {i.quantity_available}
                      </td>
                      <td>
                        <input
                          type="number"
                          min={1}
                          value={i.quantity}
                          onChange={(e) =>
                            updateItem(i.variant_id, {
                              quantity: Math.max(
                                1,
                                Math.floor(Number(e.target.value) || 1)
                              ),
                            })
                          }
                          className="cms-input cms-input-sm w-20 text-center"
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          value={i.unit_price}
                          onChange={(e) =>
                            updateItem(i.variant_id, {
                              unit_price: Math.max(
                                0,
                                Number(e.target.value) || 0
                              ),
                            })
                          }
                          className="cms-input cms-input-sm w-24 font-mono text-right"
                        />
                      </td>
                      <td className="font-mono tabular-nums">
                        €{(i.unit_price * i.quantity).toFixed(2)}
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => removeItem(i.variant_id)}
                          className="text-muted-foreground hover:text-destructive transition-colors text-lg leading-none"
                          aria-label="Αφαίρεση"
                          title="Αφαίρεση γραμμής"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {items.some((i) => i.quantity > i.quantity_available) && (
          <p className="text-xs text-destructive">
            Προσοχή: μια ή περισσότερες γραμμές υπερβαίνουν το διαθέσιμο στοκ —
            η δέσμευση θα αποτύχει στην επιβεβαίωση.
          </p>
        )}
      </section>

      {/* ═══ Πληρωμή & Παράδοση ═══ */}
      <section className="cms-card-section space-y-4">
        <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
          <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
            <Truck className="w-4 h-4" />
            Πληρωμή & Παράδοση
          </h2>
          <p className="text-sm text-foreground/70 mt-1.5">
            Καθορίστε πώς πληρώνεται η παραγγελία, πώς παραδίδεται και πού
            καταγράφεται η πηγή.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium mb-1 text-muted-foreground">
              Μέθοδος πληρωμής
            </span>
            <select
              value={paymentMethod}
              onChange={(e) =>
                setPaymentMethod(e.target.value as ManualPaymentMethod)
              }
              className="cms-input"
            >
              {PAYMENT_METHODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="block text-xs font-medium mb-1 text-muted-foreground">
              Τρόπος παράδοσης
            </span>
            <select
              value={deliveryMethod}
              onChange={(e) =>
                setDeliveryMethod(e.target.value as DeliveryMethod)
              }
              className="cms-input"
            >
              {DELIVERY_METHODS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          {deliveryMethod !== "store_pickup" && (
            <label className="block">
              <span className="block text-xs font-medium mb-1 text-muted-foreground">
                Μεταφορική εταιρεία
              </span>
              <select
                value={carrier}
                onChange={(e) => setCarrier(e.target.value as Carrier | "")}
                className="cms-input"
              >
                <option value="">(χωρίς)</option>
                {CARRIERS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block">
            <span className="block text-xs font-medium mb-1 text-muted-foreground">
              Πηγή παραγγελίας
            </span>
            <select
              value={source}
              onChange={(e) =>
                setSource(e.target.value as ManualOrderSource)
              }
              className="cms-input"
            >
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <span className="block text-[11px] text-muted-foreground mt-1 italic">
              Παραγγελίες από το eshop καταγράφονται αυτόματα — αυτή η φόρμα
              αφορά μόνο χειροκίνητες (τηλεφωνικές ή φυσικού καταστήματος).
            </span>
          </label>
        </div>
      </section>

      {/* ═══ Διευθύνσεις ═══ */}
      <section className="cms-card-section space-y-4">
        <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
          <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
            <Info className="w-4 h-4" />
            Διευθύνσεις
          </h2>
          <p className="text-sm text-foreground/70 mt-1.5">
            Διεύθυνση αποστολής και χρέωσης. Για παραλαβή από κατάστημα,
            μπορείτε να τις παραλείψετε.
          </p>
        </header>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={recipientSameAsCustomer}
            onChange={(e) => setRecipientSameAsCustomer(e.target.checked)}
          />
          <span>Ίδια στοιχεία παραλήπτη με πελάτη</span>
        </label>
        <AddressFields
          title="Αποστολή"
          value={shippingAddress}
          onChange={setShippingAddress}
          hideRecipientFields={recipientSameAsCustomer}
        />
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={billingSameAsShipping}
            onChange={(e) => setBillingSameAsShipping(e.target.checked)}
          />
          <span>Χρέωση ίδια με αποστολή</span>
        </label>
        {!billingSameAsShipping && (
          <AddressFields
            title="Χρέωση"
            value={billingAddress}
            onChange={setBillingAddress}
          />
        )}
      </section>

      {/* ═══ Σύνολο ═══ */}
      <section className="cms-card-section space-y-4">
        <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
          <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
            <Tag className="w-4 h-4" />
            Σύνολο
          </h2>
          <p className="text-sm text-foreground/70 mt-1.5">
            Έκπτωση & ΦΠΑ. Τα μεταφορικά υπολογίζονται αυτόματα από τον
            επιλεγμένο μεταφορέα και τη διεύθυνση κατά την επιβεβαίωση.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <label className="flex items-center gap-3">
              <span className="w-36 text-sm text-muted-foreground">
                Έκπτωση (€)
              </span>
              <input
                type="number"
                step="0.01"
                min={0}
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
                className="cms-input cms-input-sm w-32 font-mono text-right"
              />
            </label>
            <label className="flex items-center gap-3">
              <span className="w-36 text-sm text-muted-foreground">
                ΦΠΑ (€)
              </span>
              <input
                type="number"
                step="0.01"
                min={0}
                value={taxAmount}
                onChange={(e) => setTaxAmount(e.target.value)}
                className="cms-input cms-input-sm w-32 font-mono text-right"
              />
            </label>
            {/* Live-resolved shipping + COD — read-only, breakdown
                appears alongside the totals. */}
            <div className="flex items-center gap-3 pt-2 border-t border-foreground/10">
              <span className="w-36 text-sm text-muted-foreground">
                Μεταφορικά
                <span
                  className={`ml-1 text-[10px] cms-badge ${
                    feePreviewLoading
                      ? "cms-badge-muted"
                      : "cms-badge-neutral"
                  }`}
                  title="Υπολογίζονται live από τους κανόνες μεταφορικών + μεταφορέα + προορισμό"
                >
                  {feePreviewLoading ? "…" : "live"}
                </span>
              </span>
              <span className="font-mono text-right tabular-nums w-32">
                €{resolvedShipping.toFixed(2)}
              </span>
            </div>
            {paymentMethod === "cod" && (
              <div className="flex items-center gap-3">
                <span className="w-36 text-sm text-muted-foreground">
                  Επιβάρυνση αντικαταβολής
                  <span className="ml-1 text-[10px] cms-badge cms-badge-muted">
                    live
                  </span>
                </span>
                <span className="font-mono text-right tabular-nums w-32">
                  €{resolvedCodSurcharge.toFixed(2)}
                </span>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground italic">
              Τα μεταφορικά + επιβάρυνση αντικαταβολής υπολογίζονται live από
              τους κανόνες του καταστήματος + τον επιλεγμένο μεταφορέα. Για
              πλήρες API quote (π.χ. ACS), προστίθεται και η τιμή του
              μεταφορέα όπου ισχύει.
            </p>
            {feePreviewError && (
              <p className="text-[11px] text-destructive">
                Αδυναμία υπολογισμού: {feePreviewError}
              </p>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Υποσύνολο</dt>
            <dd className="text-right font-mono tabular-nums">
              €{subtotal.toFixed(2)}
            </dd>
            <dt className="text-muted-foreground">Έκπτωση</dt>
            <dd className="text-right font-mono tabular-nums">
              −€{(Number(discountAmount) || 0).toFixed(2)}
            </dd>
            {/* Per-fee-category lines — surfaces ALL fees the
                resolver returns (shipping, cod_handling, custom rules
                like remote-area surcharges). Each appears as its own
                line so the admin can see exactly which rule fired. */}
            {feePreview?.fees_breakdown
              .slice()
              .sort((a, b) => a.display_order - b.display_order)
              .map((fee) => (
                <FeeBreakdownLine key={fee.category_slug} fee={fee} />
              ))}
            {feePreview && feePreview.fees_breakdown.length === 0 && (
              <>
                <dt className="text-muted-foreground italic">Μεταφορικά</dt>
                <dd className="text-right font-mono tabular-nums italic text-muted-foreground">
                  —
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">ΦΠΑ</dt>
            <dd className="text-right font-mono tabular-nums">
              €{(Number(taxAmount) || 0).toFixed(2)}
            </dd>
            <dt className="font-semibold pt-2 border-t border-foreground/10">
              Σύνολο
            </dt>
            <dd className="text-right font-mono tabular-nums font-semibold pt-2 border-t border-foreground/10">
              €{total.toFixed(2)}
            </dd>
          </dl>
        </div>
      </section>

      {/* ═══ Σημειώσεις ═══ */}
      <section className="cms-card-section space-y-4">
        <header className="pb-3 -mt-1 mb-1 border-b border-foreground/15">
          <h2 className="text-base font-semibold uppercase tracking-wide text-foreground flex items-center gap-2">
            <ClipboardList className="w-4 h-4" />
            Σημειώσεις
          </h2>
          <p className="text-sm text-foreground/70 mt-1.5">
            Εσωτερικές σημειώσεις — δεν εμφανίζονται στον πελάτη.
          </p>
        </header>

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="π.χ. προτιμώμενη ώρα παράδοσης, ειδική συσκευασία…"
          className="cms-input"
        />
      </section>

      {error && (
        <p
          role="alert"
          className="text-sm text-destructive bg-destructive/5 border border-destructive/30 rounded-md px-3 py-2"
        >
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 sticky bottom-0 bg-background py-3 border-t border-foreground/10 -mx-1 px-1">
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={isPending}
          className="btn btn-secondary btn-md"
        >
          {isPending ? "…" : "Αποθήκευση ως πρόχειρο"}
        </button>
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={isPending}
          className="btn btn-primary btn-md"
        >
          {isPending ? "…" : "Επιβεβαίωση παραγγελίας"}
        </button>
      </div>
    </div>
  );
}

function AddressFields({
  title,
  value,
  onChange,
  hideRecipientFields = false,
}: {
  title: string;
  value: AddressForm;
  onChange: (v: AddressForm) => void;
  /** Hide first_name / last_name / phone — set when the parent will fill
   *  these from the chosen customer record at submit time. */
  hideRecipientFields?: boolean;
}) {
  const set = (patch: Partial<AddressForm>) => onChange({ ...value, ...patch });
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">{title}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
        {!hideRecipientFields && (
          <>
            <input
              value={value.first_name}
              onChange={(e) => set({ first_name: e.target.value })}
              onBlur={() => set({ first_name: normalizeName(value.first_name) })}
              placeholder="Όνομα"
              className="border rounded px-2 py-1"
            />
            <input
              value={value.last_name}
              onChange={(e) => set({ last_name: e.target.value })}
              onBlur={() => set({ last_name: normalizeName(value.last_name) })}
              placeholder="Επώνυμο"
              className="border rounded px-2 py-1"
            />
            <div className="md:col-span-2">
              <PhoneCountryInput
                value={value.phone}
                country={value.phoneCountry}
                onChange={({ value: digits, country }) =>
                  set({ phone: digits, phoneCountry: country })
                }
              />
            </div>
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
        <input
          value={value.notes}
          onChange={(e) => set({ notes: e.target.value })}
          onBlur={() => set({ notes: normalizeAddressLine(value.notes) })}
          placeholder="Σημειώσεις παράδοσης"
          className="border rounded px-2 py-1"
        />
      </div>
    </div>
  );
}

/**
 * One line in the live fee breakdown — uses the standard formatter
 * + a warning flag when the merchant's charged amount diverges from
 * the carrier API quote (same UX as the order detail page).
 */
function FeeBreakdownLine({
  fee,
}: {
  fee: import("@/types/fee").FeeBreakdownEntry;
}) {
  const hasMismatch =
    fee.api_quote !== null && Math.abs(fee.api_quote - fee.charged) > 0.005;
  return (
    <>
      <dt className="text-muted-foreground">
        {fee.label}
        {hasMismatch && (
          <span
            title={`Carrier quote: ${formatCurrency(fee.api_quote ?? 0, "EUR")}`}
            className="ml-1 text-amber-600"
          >
            ⚠
          </span>
        )}
      </dt>
      <dd className="text-right font-mono tabular-nums">
        €{Number(fee.charged).toFixed(2)}
      </dd>
    </>
  );
}
