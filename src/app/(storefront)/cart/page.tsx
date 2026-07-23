import { Suspense } from "react";
import { getCart } from "@/lib/cart";
import CartDrawer from "@/components/features/cart/CartDrawer";
import SessionExpiredAlert from "@/components/features/cart/SessionExpiredAlert";
import { strings } from "@/config/strings";

export const metadata = { title: strings.cart.pageTitle };

// Cart state flips between renders (priority hold grants, queue promotions,
// session releases all change wait_state). Force-dynamic prevents Next.js
// from caching the RSC payload across navigations — without it, returning
// to /cart after a promotion can serve a stale payload with wait_state
// still "pending", leaving "Ολοκλήρωση παραγγελίας" disabled.
export const dynamic = "force-dynamic";

export default async function CartPage() {
  const result = await getCart();
  const cart = result.success ? result.data : null;

  return (
    <main className="container mx-auto px-4 py-6 max-w-3xl">
      <div className="pb-4 mb-6 border-b border-stone-taupe/20">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-ink">
          {strings.cart.pageTitle}
        </h1>
      </div>
      <Suspense fallback={null}>
        <SessionExpiredAlert />
      </Suspense>
      <CartDrawer initialCart={cart} />
    </main>
  );
}
