export interface InventoryItem {
  id: string;
  variant_id: string;
  quantity_available: number;
  quantity_reserved: number;
  low_stock_threshold: number;
  updated_at: string;
}

export type StockStatus = "out" | "low" | "ok";

export function stockStatus(
  it: Pick<InventoryItem, "quantity_available" | "low_stock_threshold">
): StockStatus {
  if (it.quantity_available <= 0) return "out";
  if (it.low_stock_threshold > 0 && it.quantity_available <= it.low_stock_threshold) {
    return "low";
  }
  return "ok";
}
