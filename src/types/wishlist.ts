export interface Wishlist {
  id: string;
  customer_id: string;
  name: string;
  is_default: boolean;
  is_public: boolean;
  created_at: string;
}

export type WishlistSource = "product_page" | "contention_modal" | "sold_out_page";
export type WishlistNotificationKind = "restock" | "sale";

export interface WishlistItem {
  id: string;
  wishlist_id: string;
  customer_id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  notify_on_restock: boolean;
  notify_on_sale: boolean;
  source: WishlistSource | null;
  last_notified_at: string | null;
  last_notification_kind: WishlistNotificationKind | null;
  created_at: string;
}

export interface WishlistItemWithProduct extends WishlistItem {
  product_name: string;
  product_slug: string;
  variant_label: string | null;
  price_label: string | null;
  /** Cached effective availability snapshot — used to render restock-toggle eligibility. */
  effective_available: number;
}

export interface WishlistWithItems extends Wishlist {
  items: WishlistItem[];
}

export interface WishlistWithProductItems extends Wishlist {
  items: WishlistItemWithProduct[];
}
