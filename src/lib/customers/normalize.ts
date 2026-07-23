/**
 * Email + phone normalization, used for both storage and dedup lookups.
 *
 * Parity with the DB:
 *   - `customers.email_normalized` is generated as `NULLIF(lower(trim(email)), '')`
 *   - `customers.phone_normalized` is generated as
 *     `NULLIF(regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g'), '')`
 *
 * App code uses these helpers when issuing the dedup query so both sides
 * compute the same normalized form. Anything that drifts here will silently
 * miss matches — keep these in sync with the migration.
 */

/** Lowercase + trim. Returns null for empty/whitespace input. */
export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}

/**
 * Strip everything but digits and a leading `+`. Greek defaults: if the result
 * looks like a 10-digit local number starting with 6 (mobile) or 2 (landline),
 * we prefix `+30`. App-side smart normalization that the DB's regexp_replace
 * doesn't do — but consistent both ways (DB stores whatever app inserts).
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  // Strip whitespace, dashes, parentheses, dots — anything that isn't 0-9 or +.
  const stripped = input.replace(/[^0-9+]/g, "");
  if (stripped === "") return null;
  // Greek default-prefix heuristic: bare 10-digit number starting with 6 or 2.
  if (/^[62]\d{9}$/.test(stripped)) {
    return `+30${stripped}`;
  }
  // 12-digit starting with 30 (no plus) — add the plus.
  if (/^30[62]\d{9}$/.test(stripped)) {
    return `+${stripped}`;
  }
  return stripped;
}
