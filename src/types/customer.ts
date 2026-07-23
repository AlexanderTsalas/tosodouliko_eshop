/**
 * The business-entity customer. Every order in the system links to one of these.
 *
 * - `auth_user_id` is nullable: a row may belong to a self-signed user who can
 *   log in, or it may be an offline-only customer created by admin (phone-call,
 *   in-store sale, marketplace import). The latter never counts toward Supabase
 *   Auth MAU.
 * - `email` and `phone` are contact info, NOT identity. Multiple rows can
 *   legitimately share either or both (a family on a single email, a recycled
 *   phone number). Dedup happens at the application layer with a strict
 *   "email AND phone" prompt, never silent merging.
 * - `email_normalized` and `phone_normalized` are DB-generated columns used
 *   only for the dedup-lookup index. App code shouldn't read them directly —
 *   call `normalizeEmail()` / `normalizePhone()` from src/lib/customers/normalize
 *   for matching parity.
 */
export type CustomerSource = "eshop_signup" | "admin_manual" | "phone" | "in_store";

export interface Customer {
  id: string;
  auth_user_id: string | null;

  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;

  preferred_locale: string;
  preferred_currency: string;
  marketing_opt_in: boolean;

  source: CustomerSource;
  notes: string | null;
  /** Admin who created an offline customer record. NULL for self-signups. */
  created_by: string | null;

  created_at: string;
  updated_at: string;
}

/** Convenience helpers — display name and contact label. */
export function customerDisplayName(c: Pick<Customer, "first_name" | "last_name" | "email">): string {
  const composed = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  if (composed) return composed;
  return c.email ?? "(χωρίς στοιχεία)";
}
