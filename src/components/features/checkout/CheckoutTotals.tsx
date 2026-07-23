import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateOffersForCart } from "@/lib/offers/evaluateOffersForCart";
import { getContestableAvailableForVariants } from "@/lib/inventory/getContestableAvailable";
import { formatCurrency } from "@/lib/multi-currency/formatCurrency";
import type { CartLineForEval } from "@/types/offers";

interface CartItem {
  id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  unit_price: number;
}

interface Props {
  /** Cart line items as resolved by `getCart` on the page. */
  cartItems: CartItem[];
  /** Pre-computed cart subtotal in the active currency. */
  subtotal: number;
  /** Currency code for formatting. */
  currency: string;
  /** Customer id (used by per-customer offer conditions). */
  customerId: string;
  /** Whether the customer is signed in (vs anonymous). */
  isAuthenticated: boolean;
  /** Codes the customer has applied via the chip-builder. */
  appliedCodes: string[];
}

/**
 * Server component that runs the discount preview against the current
 * cart and renders the discount + total rows of the checkout summary
 * aside. Mounted inside a <Suspense> in the page so the rest of the
 * summary paints immediately; the discount streams in when the offers
 * engine resolves.
 *
 * Computation is identical to the original inline path in checkout/
 * page.tsx — extracted here so the page can suspend it. A failure in
 * the engine is non-fatal: we log and render the subtotal as the
 * total. The authoritative discount is still re-evaluated at
 * placeOrder time.
 */
export default async function CheckoutTotals({
  cartItems,
  subtotal,
  currency,
  customerId,
  isAuthenticated,
  appliedCodes,
}: Props) {
  const previewDiscount = await computePreviewDiscount({
    cartItems,
    currency,
    customerId,
    isAuthenticated,
    appliedCodes,
  });
  const previewTotal = Math.max(0, subtotal - previewDiscount);

  return (
    <>
      {previewDiscount > 0 && (
        <div className="flex justify-between text-sm text-emerald-700">
          <span>
            Έκπτωση κωδικού
            {appliedCodes.length === 1 && (
              <span className="text-emerald-700/70 font-mono ml-1">
                ({appliedCodes[0]})
              </span>
            )}
          </span>
          <span>−{formatCurrency(previewDiscount, currency)}</span>
        </div>
      )}
      <div className="flex justify-between font-medium pt-1 mt-1 border-t border-stone-taupe/20">
        <span className="text-ink">Σύνολο προϊόντων</span>
        <span className="font-mono font-bold text-ink">{formatCurrency(previewTotal, currency)}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        Μεταφορικά + ΦΠΑ υπολογίζονται μετά την επιλογή τρόπου παράδοσης.
        {previewDiscount > 0 &&
          " Η έκπτωση επιβεβαιώνεται στην ολοκλήρωση παραγγελίας."}
      </p>
    </>
  );
}

async function computePreviewDiscount(args: {
  cartItems: CartItem[];
  currency: string;
  customerId: string;
  isAuthenticated: boolean;
  appliedCodes: string[];
}): Promise<number> {
  if (args.cartItems.length === 0) return 0;
  try {
    const admin = createAdminClient();
    const variantIds = args.cartItems
      .map((i) => i.variant_id)
      .filter((v): v is string => !!v);
    const productIds = Array.from(
      new Set(args.cartItems.map((i) => i.product_id))
    );

    const [{ data: pcRows }, inventoryByVariant, { data: variantRows }] =
      await Promise.all([
        admin
          .from("product_categories")
          .select("product_id, category_id")
          .in("product_id", productIds),
        variantIds.length > 0
          ? getContestableAvailableForVariants(variantIds)
          : Promise.resolve(new Map<string, number>()),
        variantIds.length > 0
          ? admin
              .from("product_variants")
              .select("id, product_id, price")
              .in("id", variantIds)
          : Promise.resolve({ data: [] }),
      ]);

    const catsByProduct = new Map<string, string[]>();
    for (const pc of ((pcRows ?? []) as Array<{
      product_id: string;
      category_id: string;
    }>)) {
      const list = catsByProduct.get(pc.product_id) ?? [];
      list.push(pc.category_id);
      catsByProduct.set(pc.product_id, list);
    }

    const priceByVariant = new Map<string, number>();
    for (const v of ((variantRows ?? []) as Array<{
      id: string;
      product_id: string;
      price: number | string;
    }>)) {
      priceByVariant.set(v.id, Number(v.price));
    }

    const lines: CartLineForEval[] = args.cartItems
      .filter((i) => i.variant_id)
      .map((i) => ({
        variant_id: i.variant_id as string,
        product_id: i.product_id,
        category_ids: catsByProduct.get(i.product_id) ?? [],
        quantity: i.quantity,
        unit_price:
          priceByVariant.get(i.variant_id as string) ?? i.unit_price,
      }));
    if (lines.length === 0) return 0;

    const subtotalForEval = lines.reduce(
      (s, l) => s + l.unit_price * l.quantity,
      0
    );
    const itemCount = lines.reduce((s, l) => s + l.quantity, 0);

    const evalResult = await evaluateOffersForCart({
      lines,
      subtotal: subtotalForEval,
      itemCount,
      customerId: args.customerId,
      isAuthenticated: args.isAuthenticated,
      codes: args.appliedCodes,
      evaluationTime: new Date(),
      currency: args.currency,
      inventoryByVariant,
    });
    return evalResult.total_discount;
  } catch (e) {
    // Preview failure is non-fatal — checkout proceeds without it.
    // The customer still sees the authoritative discount at order
    // placement.
    console.error("[checkout] discount preview failed:", e);
    return 0;
  }
}
