export interface Address {
  id: string;
  /**
   * Owning customer. The address-book is keyed against the customers table
   * (not auth.users) so admin-curated offline customers can have saved
   * shipping/billing addresses too.
   */
  customer_id: string;
  label: string | null;
  first_name: string;
  last_name: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string | null;
  postal_code: string;
  country_code: string;
  phone: string | null;
  is_default: boolean;
  is_default_billing: boolean;
  is_default_shipping: boolean;
  created_at: string;
}

export type AddressInput = Omit<Address, "id" | "customer_id" | "created_at">;
