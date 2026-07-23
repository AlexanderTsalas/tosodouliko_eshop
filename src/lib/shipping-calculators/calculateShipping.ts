import { fail, ok, type Result } from "@/types/result";
import type { CalculateShippingInput, ShippingQuote } from "@/types/shipping";
import { getShippingMethods } from "./getShippingMethods";

/**
 * Calculate shipping quotes for a destination. Filters rates by weight and
 * order amount thresholds, applies free-shipping over a threshold.
 */
export async function calculateShipping(
  input: CalculateShippingInput
): Promise<Result<ShippingQuote[]>> {
  const methods = await getShippingMethods(input.countryCode);
  if (!methods.success) return fail<ShippingQuote[]>(methods.error, methods.code);

  const quotes: ShippingQuote[] = methods.data
    .filter((m) => {
      if (m.min_weight_g > input.totalWeightG) return false;
      if (m.max_weight_g !== null && input.totalWeightG > m.max_weight_g) return false;
      if (m.min_order_amount !== null && input.orderSubtotal < m.min_order_amount) return false;
      return true;
    })
    .map((m) => {
      const isFree = m.free_above !== null && input.orderSubtotal >= m.free_above;
      return {
        carrier: m.carrier,
        rateId: m.id,
        amount: isFree ? 0 : Number(m.rate),
        currency: input.currency,
      };
    });

  return ok(quotes);
}
