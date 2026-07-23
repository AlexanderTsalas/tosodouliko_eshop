export interface UserProfile {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  preferred_locale: string;
  preferred_currency: string;
  marketing_opt_in: boolean;
  /** Coarse identity boundary: 'customer' (shopper) vs 'internal' (back-office). */
  account_type: "customer" | "internal";
  created_at: string;
  updated_at: string;
}
