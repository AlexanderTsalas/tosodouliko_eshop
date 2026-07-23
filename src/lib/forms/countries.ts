import type { CountryCode } from "libphonenumber-js";

export interface CountryOption {
  /** ISO 3166-1 alpha-2 code. */
  code: CountryCode;
  /** Flag emoji + ISO2 code, e.g. "🇬🇷 GR". */
  label: string;
  /** E.164 calling code, e.g. "+30". */
  callingCode: string;
}

/**
 * Shop-supported countries. The list is shared by the phone-country
 * dropdown and the address-country dropdown so the UX stays consistent
 * — same set, same ordering, same labels. Extend as the merchant's
 * shipping destinations grow.
 *
 * Order is by commercial relevance, not alphabetical.
 */
// Note on the labels: we intentionally omit flag emojis. On Windows the
// regional-indicator codepoints fall back to plain letters (🇬🇷 renders
// as "GR"), which then collide with the ISO code text and read as
// "GR GR". Letters-only avoids the duplication on every OS.
export const SUPPORTED_COUNTRIES: CountryOption[] = [
  { code: "GR", label: "GR", callingCode: "+30" },
  { code: "CY", label: "CY", callingCode: "+357" },
  { code: "BG", label: "BG", callingCode: "+359" },
  { code: "RO", label: "RO", callingCode: "+40" },
  { code: "IT", label: "IT", callingCode: "+39" },
  { code: "DE", label: "DE", callingCode: "+49" },
  { code: "FR", label: "FR", callingCode: "+33" },
  { code: "ES", label: "ES", callingCode: "+34" },
  { code: "GB", label: "GB", callingCode: "+44" },
];

export const DEFAULT_COUNTRY: CountryCode = "GR";
