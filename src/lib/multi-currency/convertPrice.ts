import { createClient } from "@/lib/supabase/server";
import { fail, ok, type Result } from "@/types/result";
import type { PriceConversion } from "@/types/multi-currency";

/**
 * Convert a price between currencies via the `currencies.exchange_rate` table.
 * Rates are stored relative to a single base; we do a two-step convert:
 *   amount(from) * rate(to) / rate(from)
 *
 * Returns a `Result<PriceConversion>`; never throws.
 */
export async function convertPrice(
  amount: number,
  fromCurrency: string,
  toCurrency: string
): Promise<Result<PriceConversion>> {
  if (fromCurrency === toCurrency) {
    return ok({
      amount,
      fromCurrency,
      toCurrency,
      convertedAmount: amount,
      rate: 1,
    });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("currencies")
    .select("code, exchange_rate")
    .in("code", [fromCurrency, toCurrency]);

  if (error) return fail<PriceConversion>(error.message, error.code);
  if (!data || data.length < 2) {
    return fail<PriceConversion>("Currency not found", "CURRENCY_NOT_FOUND");
  }

  const rates = Object.fromEntries(
    data.map((c: any) => [c.code as string, Number(c.exchange_rate)])
  );

  const rate = rates[toCurrency] / rates[fromCurrency];
  const convertedAmount = Math.round(amount * rate * 100) / 100;

  return ok({ amount, fromCurrency, toCurrency, convertedAmount, rate });
}
