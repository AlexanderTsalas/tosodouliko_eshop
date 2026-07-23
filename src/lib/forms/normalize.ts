import {
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import {
  ZIP_LENGTH_BY_COUNTRY as STOREFRONT_ZIP_LENGTHS,
  DEFAULT_COUNTRY,
} from "@/config/storefront";

/**
 * Shared normalizer + validator helpers for checkout / order forms.
 *
 * Design rules:
 *   - All normalizers are pure and idempotent (running twice gives the same
 *     result). Safe to apply on blur AND again at submit time.
 *   - All validators take the *normalized* input — the caller is expected
 *     to normalize first.
 *   - No formatting hides user typos. A misspelled email returns a
 *     validation failure; we never auto-"correct" letters.
 *   - Name normalization is deliberately minimal until a Greek-name
 *     dictionary lands. See feedback_no_duplicate_customer_ui_hints and
 *     the per-form name handling.
 */

// -----------------------------------------------------------------------------
// Whitespace / strings
// -----------------------------------------------------------------------------

/**
 * Trim leading/trailing whitespace + collapse any internal run of
 * whitespace to a single space. Use everywhere user input is preserved
 * as-is character-wise but should be tidy.
 */
export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/**
 * Minimal name normalization — trim + collapse whitespace. For the full
 * dictionary-backed normalization with Greek tonos restoration, Latin→Greek
 * transliteration, and fuzzy matching, use normalizeNameAdvanced from
 * ./normalize-name.ts instead. This function is the safe fallback when no
 * phone-country context is available (e.g., admin forms where the customer's
 * phone country isn't on-screen).
 */
export function normalizeName(input: string): string {
  return normalizeWhitespace(input);
}

export {
  normalizeNameAdvanced,
  normalizeSurnameAdvanced,
  type NameNormalizationResult,
} from "./normalize-name";


// -----------------------------------------------------------------------------
// Email
// -----------------------------------------------------------------------------

const EMAIL_REGEX =
  /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

/**
 * Trim + lowercase. Doesn't validate; pair with isValidEmail.
 */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidEmail(normalized: string): boolean {
  if (!normalized) return false;
  return EMAIL_REGEX.test(normalized);
}

// -----------------------------------------------------------------------------
// Phone
// -----------------------------------------------------------------------------

export interface PhoneParts {
  /** ISO2 country code, e.g. "GR", "CY", "GB". */
  country: CountryCode;
  /** Subscriber digits only, no spaces, no plus, no country prefix. */
  digits: string;
  /** Canonical E.164 string, e.g. "+30210...". Empty when invalid. */
  e164: string;
  /** Pretty national display, e.g. "210 123 4567". Empty when invalid. */
  display: string;
  valid: boolean;
}

export const DEFAULT_PHONE_COUNTRY: CountryCode = DEFAULT_COUNTRY;

/**
 * Parse a phone input. If the user typed a "+<prefix>" anywhere in the
 * string, the prefix wins and we re-derive the country from it. Otherwise
 * the passed `country` arg is used as the default.
 *
 * Returns a PhoneParts object. `valid` is true iff libphonenumber accepts
 * the result as a valid number for that country.
 *
 * The function is forgiving on input (handles spaces, dashes, parens,
 * dots). Submit handlers should write `e164` into the order payload — never
 * the raw user input.
 */
export function parsePhoneInput(
  input: string,
  country: CountryCode = DEFAULT_PHONE_COUNTRY
): PhoneParts {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      country,
      digits: "",
      e164: "",
      display: "",
      valid: false,
    };
  }
  // libphonenumber-js auto-detects the country when a leading + is
  // present. Without +, we pass the default country so it parses the
  // digits as a local number.
  const startsWithPlus = trimmed.startsWith("+");
  const parsed = parsePhoneNumberFromString(
    trimmed,
    startsWithPlus ? undefined : country
  );
  if (!parsed) {
    return {
      country,
      digits: trimmed.replace(/\D/g, ""),
      e164: "",
      display: "",
      valid: false,
    };
  }
  const resolvedCountry = (parsed.country ?? country) as CountryCode;
  const digits = parsed.nationalNumber.toString();
  return {
    country: resolvedCountry,
    digits,
    e164: parsed.number,
    display: parsed.formatNational(),
    valid: parsed.isValid(),
  };
}

/**
 * Re-format the user's input into the national-pretty form for the given
 * country. Empty input → empty output. Invalid input passes through
 * digits-only so the user can keep editing.
 */
export function formatPhoneForDisplay(
  input: string,
  country: CountryCode
): string {
  const p = parsePhoneInput(input, country);
  if (p.valid) return p.display;
  // Not yet valid — strip everything except digits and a leading +.
  return input.replace(/[^\d+]/g, "");
}

// -----------------------------------------------------------------------------
// Postal code
// -----------------------------------------------------------------------------

/**
 * Strip everything that isn't a digit or letter (postal codes in some
 * countries — e.g. UK — include letters). For GR / CY / most EU
 * countries it ends up digits-only.
 */
export function normalizeZip(input: string, _country: string = "GR"): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

// ZIP_LENGTH_BY_COUNTRY is derived from SUPPORTED_COUNTRIES in storefront.ts.
// The local alias keeps the function signatures below unchanged.
const ZIP_LENGTH_BY_COUNTRY = STOREFRONT_ZIP_LENGTHS;

/**
 * Maximum ZIP-input length for a country, used to hard-cap text-input
 * width while typing. Returns null when the country has a variable
 * length (e.g. UK) — caller should impose no cap in that case.
 */
export function getZipMaxLength(country: string): number | null {
  const len = ZIP_LENGTH_BY_COUNTRY[country.toUpperCase()];
  if (len === undefined || len === 0) return null;
  return len;
}

export function isValidZip(normalized: string, country: string = "GR"): boolean {
  if (!normalized) return false;
  const expected = ZIP_LENGTH_BY_COUNTRY[country.toUpperCase()];
  if (expected === undefined || expected === 0) {
    // Country without a strict numeric length — at least 3 chars.
    return normalized.length >= 3;
  }
  if (normalized.length !== expected) return false;
  // Country codes in this map are digit-only postal systems.
  return /^\d+$/.test(normalized);
}

// -----------------------------------------------------------------------------
// Street / address line / city
// -----------------------------------------------------------------------------

/**
 * Generic address-line normalizer: trim + collapse whitespace.
 * Intentionally does NOT change case — street/city/region names vary
 * idiosyncratically (e.g. "Πατησίων" vs "ΠΑΤΗΣΙΩΝ") and the user's intent
 * is preserved.
 */
export function normalizeAddressLine(input: string): string {
  return normalizeWhitespace(input);
}
