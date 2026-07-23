import { getActiveCurrency } from "@/lib/multi-currency/getActiveCurrency";
import { getCurrencyRates, convertWithRates } from "@/lib/multi-currency/getCurrencyRates";
import { formatCurrency } from "@/lib/multi-currency/formatCurrency";

interface PriceProps {
  /** The numeric amount in the source currency. */
  amount: number;
  /** The source currency code the amount is stored in. Defaults to EUR. */
  currency?: string;
  /** Override the display currency (defaults to the user's active selection). */
  displayCurrency?: string;
  /** BCP-47 locale for formatting. Defaults to el-GR. */
  locale?: string;
  className?: string;
}

/**
 * Server component that converts an amount from its source currency into the
 * user's currently-selected display currency and renders it formatted.
 *
 * Usage:
 *   <Price amount={p.base_price} currency={p.currency} />
 */
export default async function Price({
  amount,
  currency = "EUR",
  displayCurrency,
  locale = "el-GR",
  className,
}: PriceProps) {
  const active = displayCurrency ?? (await getActiveCurrency());
  const rates = await getCurrencyRates();
  const converted = convertWithRates(amount, currency, active, rates);
  const formatted = formatCurrency(converted, active, locale);
  return <span className={className}>{formatted}</span>;
}
