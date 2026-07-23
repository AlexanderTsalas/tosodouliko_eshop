export interface Currency {
  code: string;
  name: string;
  symbol: string;
  exchange_rate: number;
  decimal_digits: number;
  active: boolean;
  updated_at: string;
}

export interface PriceConversion {
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  convertedAmount: number;
  rate: number;
}
