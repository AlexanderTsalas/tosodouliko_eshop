export interface Supplier {
  id: string;
  name: string;
  primary_email: string | null;
  primary_phone: string | null;
  /** ISO 4217. The currency this supplier typically invoices in. */
  default_currency: string;
  street: string | null;
  city: string | null;
  postal_code: string | null;
  /** ISO 3166-1 alpha-2. */
  country_code: string | null;
  notes: string | null;
  /** Per-supplier remembered CSV column-header → field name map. */
  receipt_column_map: ReceiptColumnMap | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/** Maps a field name (left) to the header string the supplier uses (right). */
export interface ReceiptColumnMap {
  supplier_sku?: string;
  quantity?: string;
  unit_cost?: string;
  /** Free extras keyed by column name (for forward-compat). */
  [key: string]: string | undefined;
}

export interface SupplierProduct {
  id: string;
  variant_id: string;
  supplier_id: string;
  supplier_sku: string | null;
  lead_time_days: number | null;
  is_preferred: boolean;
  notes: string | null;
  active: boolean;
  /**
   * Negotiated unit cost from this supplier for this variant. Both
   * unit_cost and unit_cost_currency are either both NULL (unknown,
   * fall back to products.cost_price) or both set (use this).
   */
  unit_cost: number | null;
  unit_cost_currency: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseLot {
  id: string;
  variant_id: string;
  supplier_id: string | null;
  supply_order_id: string | null;
  received_qty: number;
  unit_cost: number;
  unit_cost_currency: string;
  received_at: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export type SupplyOrderStatus = "draft" | "placed" | "received" | "cancelled";

export interface SupplyOrder {
  id: string;
  supplier_id: string;
  status: SupplyOrderStatus;
  placed_at: string | null;
  received_at: string | null;
  notes: string | null;
  receipt_file_storage_key: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupplyOrderLine {
  id: string;
  supply_order_id: string;
  variant_id: string;
  business_sku_at_draft: string;
  supplier_sku_at_draft: string | null;
  variant_label: string | null;
  qty_at_draft: number | null;
  threshold_at_draft: number | null;
  ordered_qty: number;
  received_qty: number | null;
  unit_cost: number | null;
  unit_cost_currency: string | null;
  received_unit_cost: number | null;
  notes: string | null;
  created_at: string;
}

/**
 * Composed view of one supplier's *current* cost for a variant, derived
 * from supplier_products + the latest purchase_lots row. Built by
 * `getSuppliersForVariant`; never stored.
 */
export interface SupplierCurrentCost {
  supplier_product_id: string;
  supplier_id: string;
  supplier_name: string;
  supplier_sku: string | null;
  lead_time_days: number | null;
  is_preferred: boolean;
  /** From the latest purchase_lots row; null if no lots yet (new relationship). */
  last_unit_cost: number | null;
  last_unit_cost_currency: string | null;
  last_received_at: string | null;
  /** Computed flags for the picker UI. */
  is_cheapest: boolean;
  /** True if last_received_at is older than ~60 days (cost is likely stale). */
  is_stale: boolean;
  /** True if there are no purchase_lots rows yet — cost is unknown. */
  has_no_history: boolean;
}

/**
 * Bucketing of low/out-of-stock variants for the Supply Orders Drafts page.
 * Variants with track_supply=false are excluded upstream.
 */
export interface LowStockBuckets {
  /** Variants with exactly one supplier — straight into that supplier's working list. */
  bySupplier: Map<string, LowStockVariant[]>;
  /** Variants with >1 supplier — admin must pick at order-time. */
  multiSource: LowStockVariant[];
  /** Variants with no supplier_products row — surfaced as an alert banner. */
  unassigned: LowStockVariant[];
  /**
   * Per supplier, the supply_order_lines from that supplier's `placed`
   * (awaiting delivery) orders. Used by the Drafts page to render an
   * informational "Παραγγέλθηκαν - Σε αναμονή παράδοσης" block per supplier,
   * and to suppress same-supplier placed variants from that supplier's
   * suggestions (so we don't keep nagging the admin to re-order what they
   * just ordered). Other suppliers' suggestions are unaffected — the variant
   * is still re-draftable elsewhere.
   */
  placedBySupplier: Map<string, PlacedSupplyLine[]>;
}

/**
 * A supply_order_lines row from a placed (not yet received) order, enriched
 * with the parent order's id and placed_at timestamp so the UI can link
 * straight to it. We rely on the line's existing snapshot fields
 * (variant_label, business_sku_at_draft) for display — no extra join needed.
 */
export interface PlacedSupplyLine {
  line_id: string;
  supply_order_id: string;
  variant_id: string;
  variant_label: string | null;
  business_sku_at_draft: string;
  ordered_qty: number;
  unit_cost: number | null;
  unit_cost_currency: string | null;
  placed_at: string | null;
}

export interface LowStockVariant {
  variant_id: string;
  product_id: string;
  product_name: string;
  variant_label: string | null;
  business_sku: string;
  quantity_available: number;
  low_stock_threshold: number;
  /** Customer-facing sale price, snapshotted from product_variants.price at read time. */
  sale_price: number;
  /** From inventory_items via stockStatus(). */
  status: "low" | "out";
  /** All known supplier_products rows for this variant (with computed cost). */
  suppliers: SupplierCurrentCost[];
}
