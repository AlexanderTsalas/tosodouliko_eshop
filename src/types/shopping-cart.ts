export type CartStatus = "active" | "abandoned" | "converted";

export interface Cart {
  id: string;
  user_id: string | null;
  guest_token: string | null;
  status: CartStatus;
  subtotal: number;
  item_count: number;
  created_at: string;
  updated_at: string;
}

export interface CartItem {
  id: string;
  cart_id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  unit_price: number;
  /** Phase 8g: per-unit sum of custom-field modifiers locked at
   *  add-to-cart. Always >= 0. Default 0 for lines with no custom
   *  fields. */
  modifier_total: number;
  created_at: string;
}

/** Phase 8h: per-line frozen custom-field rows surfaced by the cart
 *  UI so the customer can see what they configured at add-to-cart. */
export interface CartItemCustomFieldSummary {
  field_id: string;
  field_label: string;
  /** Human-readable display: dropdown label, "Ναι"/"Όχι", text content
   *  itself, joined multi-select labels. */
  display_value: string;
  /** Per-unit contribution; multiplied by line quantity for totals. */
  contributed_price: number;
}

export interface CartItemWithProduct extends CartItem {
  product_name: string;
  product_slug: string;
  variant_label?: string;
  image_url?: string;
  custom_fields?: CartItemCustomFieldSummary[];
  /**
   * Phase 4: queue state for this item.
   *  - "pending": customer is in the soft-wait queue (cannot proceed to checkout).
   *  - "promoted": their soft-wait was promoted to a 5-min priority hold; can checkout.
   *  - undefined: not in a queue.
   */
  wait_state?: "pending" | "promoted";
  /** When wait_state === "promoted", the priority hold's expiry. ISO string. */
  priority_expires_at?: string;
  /**
   * 1-based queue position when `wait_state === "pending"`. Other waiters with
   * earlier `created_at` for the same parent session are counted ahead. Live-
   * updates via Realtime as the queue shrinks or grows.
   */
  queue_position?: number;
  /** id of the customer's own soft_waits row (used by the presence ping). */
  soft_wait_id?: string;
}

export interface CartWithItems extends Cart {
  items: CartItemWithProduct[];
}

export interface AddToCartInput {
  productId: string;
  variantId?: string;
  quantity: number;
}
