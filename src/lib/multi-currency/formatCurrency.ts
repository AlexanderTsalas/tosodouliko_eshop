/**
 * Format a numeric amount as a localized currency string.
 *
 * Pure function — no DB / API calls. Uses Intl.NumberFormat which is
 * client-and-server safe.
 */
export function formatCurrency(
  amount: number,
  currency = "EUR",
  locale = "el-GR"
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
