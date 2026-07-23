import Link from "next/link";
import { getCartItemCount } from "@/lib/cart";
import MaskIcon from "@/components/layout/MaskIcon";
import { strings } from "@/config/strings";

/**
 * Dynamic portion of the Header — cart count only (no profile/account icon,
 * per client request — matches the original site's header). Rendered inside a
 * Suspense boundary so the static shell (logo, search, nav) displays instantly
 * from cache while this streams in.
 */
export default async function HeaderAuth() {
  const cartCount = await getCartItemCount();

  return (
    <>
      <Link
        href="/wishlist"
        aria-label={strings.layout.nav.wishlist}
        className="icon-wiggle-group hidden sm:inline-flex p-2 items-center justify-center text-[#4a3320] hover:text-terracotta transition-colors"
      >
        <MaskIcon src="/icons_svgs/wishlist.svg" className="icon-wiggle w-14 h-14" />
      </Link>
      <Link
        href="/cart"
        aria-label={
          cartCount > 0
            ? strings.layout.nav.cartWithCount.replace("{count}", String(cartCount))
            : strings.layout.nav.cart
        }
        className="icon-wiggle-group p-2 inline-flex items-center justify-center text-[#4a3320] hover:text-terracotta transition-colors"
      >
        <span className="relative inline-flex">
          <MaskIcon src="/icons_svgs/cart.svg" className="icon-wiggle w-14 h-14" />
          {cartCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[20px] h-[20px] px-1 bg-terracotta text-canvas text-[10px] rounded-full flex items-center justify-center font-mono font-bold ring-2 ring-canvas">
              {cartCount}
            </span>
          )}
        </span>
      </Link>
    </>
  );
}
