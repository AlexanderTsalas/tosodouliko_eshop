export type DiscountType = "percent" | "fixed" | "free_shipping";

export interface DiscountCode {
  id: string;
  code: string;
  type: DiscountType;
  value: number;
  usage_limit: number | null;
  usage_count: number;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface DiscountUsage {
  id: string;
  discount_id: string;
  user_id: string | null;
  order_id: string | null;
  amount_applied: number;
  created_at: string;
}

export interface ValidatedDiscount {
  code: DiscountCode;
  amountOff: number;
  freeShipping: boolean;
}
