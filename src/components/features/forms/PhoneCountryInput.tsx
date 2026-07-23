"use client";

import { useEffect, useState } from "react";
import {
  parsePhoneInput,
  formatPhoneForDisplay,
  DEFAULT_PHONE_COUNTRY,
} from "@/lib/forms/normalize";
import {
  SUPPORTED_COUNTRIES,
  MAX_PHONE_DIGITS_BY_COUNTRY,
} from "@/config/storefront";
import type { CountryCode } from "libphonenumber-js";

// MAX_PHONE_DIGITS_BY_COUNTRY imported from @/config/storefront.

interface Props {
  /** Subscriber-only digits (no country prefix). Stored in form state. */
  value: string;
  /** ISO2 country code currently selected. */
  country: CountryCode;
  /** Called with new (digits, country) on every change. */
  onChange: (next: { value: string; country: CountryCode }) => void;
  placeholder?: string;
  className?: string;
  /** When true, render a thin red border. */
  invalid?: boolean;
}

/**
 * Phone input + country selector combo.
 *
 *   - The dropdown selects the country (default GR).
 *   - If the user types a leading "+<code>" in the number field, the
 *     country auto-switches and the prefix is stripped from the digits.
 *   - On blur the digits are re-formatted into the national-pretty form
 *     for the chosen country (e.g. "210 123 4567"). Invalid input is
 *     left as a digits-only string so the user can keep editing.
 *   - The component stores national digits only in `value`. Callers that
 *     need E.164 (e.g. submit-time) call `parsePhoneInput` and read
 *     `.e164`.
 */
export default function PhoneCountryInput({
  value,
  country,
  onChange,
  placeholder = "Τηλέφωνο",
  className = "",
  invalid = false,
}: Props) {
  // Local "display" copy so on-blur reformat can show pretty form without
  // breaking the parent's source-of-truth digit string.
  const [display, setDisplay] = useState(value);

  // Keep display in sync when the parent value changes for reasons other
  // than user typing (e.g. mirroring buyer's phone via "Ίδια στοιχεία").
  useEffect(() => {
    setDisplay(value);
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;

    // Live: if user typed a + prefix, re-detect country.
    const parsed = parsePhoneInput(raw, country);
    const resolvedCountry = parsed.country;
    const cap = MAX_PHONE_DIGITS_BY_COUNTRY[resolvedCountry];
    let digits = parsed.digits || raw.replace(/\D/g, "");

    // Hard cap input length per country — e.g. GR is exactly 10 digits,
    // so anything past that is silently dropped from both the display
    // and the stored value. This makes overflow physically impossible
    // for the user, rather than catching it at submit time.
    if (cap !== undefined && digits.length > cap) {
      digits = digits.slice(0, cap);
    }

    // If we truncated, rewrite the display string to match — strips
    // formatting characters too, but the on-blur formatter restores
    // them. If we didn't truncate, preserve the user's raw typing so
    // they can keep editing freely (spaces, dashes, etc.).
    const wasTruncated = cap !== undefined && digits.length === cap &&
      raw.replace(/\D/g, "").length > cap;
    setDisplay(wasTruncated ? digits : raw);

    onChange({
      value: digits,
      country: resolvedCountry,
    });
  }

  function handleBlur() {
    const formatted = formatPhoneForDisplay(display, country);
    setDisplay(formatted);
  }

  function handleCountryChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as CountryCode;
    onChange({ value, country: next });
    // Refresh the display for the new country's format.
    setDisplay(formatPhoneForDisplay(display, next));
  }

  const borderClass = invalid ? "border-destructive" : "";
  const callingCode =
    SUPPORTED_COUNTRIES.find((c) => c.code === country)?.callingCode ?? "+30";

  return (
    <div className={`flex gap-2 ${className}`}>
      <select
        value={country}
        onChange={handleCountryChange}
        className={`border rounded px-2 py-1 text-sm ${borderClass}`}
        aria-label="Κωδικός χώρας"
      >
        {SUPPORTED_COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.label} ({c.callingCode})
          </option>
        ))}
      </select>
      <input
        type="tel"
        inputMode="tel"
        value={display}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={`${placeholder} (${callingCode})`}
        className={`border rounded px-2 py-1 flex-1 text-sm ${borderClass}`}
      />
    </div>
  );
}

/** Re-exported so callers don't need a second import from the lib. */
export { DEFAULT_PHONE_COUNTRY };
