"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAddress } from "@/actions/addresses/saveAddress";
import type { Address } from "@/types/address-book";
import PhoneCountryInput from "@/components/features/forms/PhoneCountryInput";
import {
  normalizeName,
  normalizeZip,
  normalizeAddressLine,
  parsePhoneInput,
  getZipMaxLength,
  DEFAULT_PHONE_COUNTRY,
} from "@/lib/forms/normalize";
import { SUPPORTED_COUNTRIES, DEFAULT_COUNTRY } from "@/config/storefront";
import type { CountryCode } from "libphonenumber-js";

interface AddressFormProps {
  /** When set, the form runs in EDIT mode for this address (UPDATE on submit). */
  initial?: Address;
  /** Called after a successful save (created / updated / dedup match). */
  onSaved?: (address: Address) => void;
  /** Called when the user clicks "Cancel" in edit mode. */
  onCancel?: () => void;
}

interface FieldState {
  label: string;
  first_name: string;
  last_name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  country_code: string;
  phone: string;
  /** ISO2 country for the phone, separate from the address country. */
  phone_country: CountryCode;
  is_default_shipping: boolean;
  is_default_billing: boolean;
}

function emptyFields(initial?: Address): FieldState {
  return {
    label: initial?.label ?? "",
    first_name: initial?.first_name ?? "",
    last_name: initial?.last_name ?? "",
    address_line1: initial?.address_line1 ?? "",
    address_line2: initial?.address_line2 ?? "",
    city: initial?.city ?? "",
    state: initial?.state ?? "",
    postal_code: initial?.postal_code ?? "",
    country_code: initial?.country_code ?? DEFAULT_COUNTRY,
    phone: initial?.phone ?? "",
    phone_country: DEFAULT_PHONE_COUNTRY,
    is_default_shipping: initial?.is_default_shipping ?? false,
    is_default_billing: initial?.is_default_billing ?? false,
  };
}

export default function AddressForm({ initial, onSaved, onCancel }: AddressFormProps) {
  const router = useRouter();
  const [fields, setFields] = useState<FieldState>(() => emptyFields(initial));
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isEdit = !!initial;

  function update<K extends keyof FieldState>(key: K, value: FieldState[K]) {
    setFields((cur) => ({ ...cur, [key]: value }));
  }

  function submit() {
    setError(null);
    setStatusMsg(null);

    // Idempotent submit-time normalization, even if the user submits
    // without blurring fields.
    const phoneE164 = parsePhoneInput(fields.phone, fields.phone_country).e164;
    startTransition(async () => {
      const r = await saveAddress({
        id: initial?.id,
        label: fields.label.trim() || null,
        first_name: normalizeName(fields.first_name),
        last_name: normalizeName(fields.last_name),
        address_line1: normalizeAddressLine(fields.address_line1),
        address_line2: normalizeAddressLine(fields.address_line2) || null,
        city: normalizeAddressLine(fields.city),
        state: normalizeAddressLine(fields.state) || null,
        postal_code: normalizeZip(fields.postal_code, fields.country_code),
        country_code: fields.country_code.toUpperCase(),
        phone: phoneE164 || fields.phone.trim() || null,
        is_default_shipping: fields.is_default_shipping,
        is_default_billing: fields.is_default_billing,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }

      if (r.data.outcome === "already_exists") {
        setStatusMsg("Έχετε ήδη αυτή τη διεύθυνση. Δεν δημιουργήθηκε διπλότυπη.");
        if (!isEdit) setFields(emptyFields());
        router.refresh();
        onSaved?.(r.data.address);
        return;
      }

      if (isEdit) {
        setStatusMsg("✓ Η διεύθυνση ενημερώθηκε.");
      } else {
        setStatusMsg("✓ Η διεύθυνση αποθηκεύτηκε.");
        setFields(emptyFields());
      }
      router.refresh();
      onSaved?.(r.data.address);
    });
  }

  return (
    <div className="grid grid-cols-2 gap-3 max-w-xl">
      <input
        value={fields.label}
        onChange={(e) => update("label", e.target.value)}
        placeholder="Ετικέτα (π.χ. Σπίτι)"
        className="border rounded px-3 py-2 col-span-2"
      />
      <input
        value={fields.first_name}
        onChange={(e) => update("first_name", e.target.value)}
        onBlur={() => update("first_name", normalizeName(fields.first_name))}
        required
        placeholder="Όνομα"
        className="border rounded px-3 py-2"
      />
      <input
        value={fields.last_name}
        onChange={(e) => update("last_name", e.target.value)}
        onBlur={() => update("last_name", normalizeName(fields.last_name))}
        required
        placeholder="Επώνυμο"
        className="border rounded px-3 py-2"
      />
      <input
        value={fields.address_line1}
        onChange={(e) => update("address_line1", e.target.value)}
        onBlur={() => update("address_line1", normalizeAddressLine(fields.address_line1))}
        required
        placeholder="Διεύθυνση"
        className="border rounded px-3 py-2 col-span-2"
      />
      <input
        value={fields.address_line2}
        onChange={(e) => update("address_line2", e.target.value)}
        onBlur={() => update("address_line2", normalizeAddressLine(fields.address_line2))}
        placeholder="Διεύθυνση 2 (προαιρετικό)"
        className="border rounded px-3 py-2 col-span-2"
      />
      <input
        value={fields.city}
        onChange={(e) => update("city", e.target.value)}
        onBlur={() => update("city", normalizeAddressLine(fields.city))}
        required
        placeholder="Πόλη"
        className="border rounded px-3 py-2"
      />
      <input
        value={fields.state}
        onChange={(e) => update("state", e.target.value)}
        onBlur={() => update("state", normalizeAddressLine(fields.state))}
        placeholder="Νομός"
        className="border rounded px-3 py-2"
      />
      <input
        value={fields.postal_code}
        onChange={(e) => {
          const cap = getZipMaxLength(fields.country_code);
          const raw = e.target.value.replace(/[^A-Za-z0-9]/g, "");
          update("postal_code", cap !== null ? raw.slice(0, cap) : raw);
        }}
        onBlur={() => update("postal_code", normalizeZip(fields.postal_code, fields.country_code))}
        inputMode={getZipMaxLength(fields.country_code) !== null ? "numeric" : "text"}
        pattern={getZipMaxLength(fields.country_code) !== null ? "[0-9]*" : undefined}
        maxLength={getZipMaxLength(fields.country_code) ?? undefined}
        required
        placeholder="Τ.Κ."
        className="border rounded px-3 py-2"
      />
      <select
        value={fields.country_code}
        onChange={(e) => update("country_code", e.target.value)}
        required
        className="border rounded px-3 py-2 bg-background"
        aria-label="Χώρα"
      >
        {SUPPORTED_COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.label}
          </option>
        ))}
      </select>
      <div className="col-span-2">
        <PhoneCountryInput
          value={fields.phone}
          country={fields.phone_country}
          onChange={({ value, country }) => {
            update("phone", value);
            update("phone_country", country);
          }}
        />
      </div>

      <label className="flex items-center gap-2 text-sm col-span-2">
        <input
          type="checkbox"
          checked={fields.is_default_shipping}
          onChange={(e) => update("is_default_shipping", e.target.checked)}
        />
        <span>Προεπιλογή για αποστολή</span>
      </label>
      <label className="flex items-center gap-2 text-sm col-span-2">
        <input
          type="checkbox"
          checked={fields.is_default_billing}
          onChange={(e) => update("is_default_billing", e.target.checked)}
        />
        <span>Προεπιλογή για χρέωση</span>
      </label>

      {error && (
        <p className="text-sm text-destructive col-span-2" role="alert">
          {error}
        </p>
      )}
      {statusMsg && !error && (
        <p className="text-sm text-emerald-700 col-span-2" role="status">
          {statusMsg}
        </p>
      )}

      <div className="col-span-2 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          className="flex-1 rounded bg-primary text-primary-foreground py-2 disabled:opacity-50"
        >
          {isPending ? "Αποθήκευση..." : isEdit ? "Αποθήκευση αλλαγών" : "Αποθήκευση"}
        </button>
        {isEdit && (
          <button
            type="button"
            onClick={() => onCancel?.()}
            disabled={isPending}
            className="rounded border px-4 py-2 disabled:opacity-50"
          >
            Άκυρο
          </button>
        )}
      </div>
    </div>
  );
}
