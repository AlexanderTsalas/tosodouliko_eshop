export interface ShippingZone {
  id: string;
  name: string;
  code: string;
  country_codes: string[];
  active: boolean;
  created_at: string;
}

export interface ShippingRate {
  id: string;
  carrier: string;
  zone: string;
  zone_id: string | null;
  min_weight_g: number;
  max_weight_g: number | null;
  min_order_amount: number | null;
  rate: number;
  free_above: number | null;
  active: boolean;
  created_at: string;
}

export interface ShippingRateTier {
  id: string;
  rate_id: string;
  min_value: number;
  max_value: number | null;
  price: number;
  unit: "weight" | "amount" | "quantity";
  created_at: string;
}

export interface ShippingQuote {
  carrier: string;
  rateId: string;
  amount: number;
  currency: string;
  estimatedDays?: number;
}

export interface CalculateShippingInput {
  countryCode: string;
  totalWeightG: number;
  orderSubtotal: number;
  currency: string;
}
