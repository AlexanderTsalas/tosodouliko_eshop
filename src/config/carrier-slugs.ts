/**
 * Carrier slug type system — see ADR-12 in
 * docs/features/courier-integration-design.md.
 *
 * Two types exist for two purposes:
 *
 *   BuiltInCarrierSlug — narrow literal union of the 6 built-in carriers.
 *                        Use this where runtime behavior is hardcoded
 *                        (provider-class lookups, payment overrides, etc.)
 *                        so the compiler enforces exhaustiveness.
 *
 *   CarrierSlug        — plain `string`. Includes built-ins AND custom
 *                        admin-created carriers. Use for general carrier
 *                        identifiers passed through the order flow.
 *
 * Runtime safety comes from:
 *   - Zod validation at server-action boundaries (slug must exist in
 *     delivery_carriers)
 *   - DB foreign keys on orders.carrier_slug and
 *     carrier_provider_configs.carrier
 *   - RLS policies
 *
 * The relaxation from CarrierValue (literal union) to CarrierSlug (string)
 * trades a small amount of compile-time exhaustiveness for admin
 * extensibility. The mitigations above keep the security surface unchanged.
 */

/**
 * Stable slugs for the 6 built-in carriers. These are the only slugs whose
 * runtime behavior the code branches on (provider class loading, payment
 * overrides for COD-at-locker, etc.).
 *
 * Adding a 7th built-in carrier requires:
 *   - Adding its slug to this union
 *   - Adding a row to the delivery_carriers seed
 *   - Adding a provider class implementing CarrierProvider
 *   - Adding it to loadCarrierProvider's switch
 *   - Adding it to TIMELINE_BY_CARRIER
 *   - Adding it to API_MAPPING_BY_CARRIER if it has tracking
 */
export type BuiltInCarrierSlug =
  | "acs"
  | "elta"
  | "box_now"
  | "speedex"
  | "geniki"
  | "other";

/**
 * Any carrier slug — built-in OR admin-created custom. Stored as plain text
 * in orders.carrier_slug. Use this in code paths that operate on carriers
 * generically (e.g., fee resolution, address validation, voucher creation
 * dispatch).
 */
export type CarrierSlug = string;

/** Frozen array of built-in slugs for runtime checks. */
export const BUILT_IN_CARRIER_SLUGS = [
  "acs",
  "elta",
  "box_now",
  "speedex",
  "geniki",
  "other",
] as const satisfies readonly BuiltInCarrierSlug[];

/**
 * Type guard: narrows a CarrierSlug to BuiltInCarrierSlug. Use before
 * accessing hardcoded carrier-specific configuration (e.g. PAYMENT_OVERRIDES,
 * a switch on built-in slugs in provider loading).
 *
 *   if (isBuiltInCarrier(slug)) {
 *     // slug is BuiltInCarrierSlug — safe to index into PAYMENT_OVERRIDES
 *   }
 */
export function isBuiltInCarrier(slug: string): slug is BuiltInCarrierSlug {
  return (BUILT_IN_CARRIER_SLUGS as readonly string[]).includes(slug);
}

// ---------------------------------------------------------------------------
// Hardcoded constants for code that references specific built-in slugs.
// Use these instead of string literals — typo-safe and refactorable.
// ---------------------------------------------------------------------------

export const ACS_SLUG: BuiltInCarrierSlug = "acs";
export const ELTA_SLUG: BuiltInCarrierSlug = "elta";
export const BOX_NOW_SLUG: BuiltInCarrierSlug = "box_now";
export const SPEEDEX_SLUG: BuiltInCarrierSlug = "speedex";
export const GENIKI_SLUG: BuiltInCarrierSlug = "geniki";
export const OTHER_SLUG: BuiltInCarrierSlug = "other";
