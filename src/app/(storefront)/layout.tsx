import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import PageTransitionWrapper from "@/components/layout/PageTransitionWrapper";
import PromotionWatcher from "@/components/features/contention/PromotionWatcher";
import CollapseWatcher from "@/components/features/contention/CollapseWatcher";
import SoftWaitNextInLineWatcher from "@/components/features/contention/SoftWaitNextInLineWatcher";

/**
 * Storefront route-group layout. Wraps every customer-facing route
 * (home, products, cart, checkout, orders, wishlist, account, auth) with
 * the public site chrome (Header + Footer) and the contention watchers
 * that drive in-app notifications during inventory contention flows.
 *
 * Admin routes deliberately live OUTSIDE this group — their own layout
 * skips Header/Footer entirely so the CMS feels like a separate
 * application. See src/app/admin/layout.tsx.
 *
 * Route groups (parenthesized segments) are invisible in the URL —
 * `/cart` and `/products/[slug]` still resolve from `src/app/(storefront)/`
 * after the move.
 */
export default function StorefrontLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <Header />
      <div className="storefront-root flex-1">
        <PageTransitionWrapper>{children}</PageTransitionWrapper>
      </div>
      <Footer />
      <PromotionWatcher />
      <CollapseWatcher />
      <SoftWaitNextInLineWatcher />
    </>
  );
}
