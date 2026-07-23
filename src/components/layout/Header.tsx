import { Suspense } from "react";
import Link from "next/link";
import { Facebook, Instagram, Calendar } from "lucide-react";
import TikTokIcon from "@/components/layout/TikTokIcon";
import { getCurrencies } from "@/lib/multi-currency/getCurrencies";
import { getActiveCurrency } from "@/lib/multi-currency/getActiveCurrency";
import SearchBar from "@/components/features/site-search/SearchBar";
import CurrencySwitcher from "@/components/features/multi-currency/CurrencySwitcher";
import LanguageSwitcher from "@/components/features/translation-layer/LanguageSwitcher";
import HeaderAuth from "@/components/layout/HeaderAuth";
import BrandLogo from "@/components/layout/BrandLogo";
import MainNav from "@/components/layout/MainNav";
import MobileMenu from "@/components/layout/MobileMenu";
import type { Currency } from "@/types/multi-currency";
import { brand } from "@/config/brand";
import { strings } from "@/config/strings";

/**
 * Storefront header — design matched to the reference (cala_gemini_studio).
 *
 *  1. Top utility bar (ink): socials + tagline on the left; compact search,
 *     wishlist and the "Ραντεβού" (appointment → /contact) CTA on the right.
 *  2. Sticky main bar (canvas): mobile menu + brand logo, the desktop nav
 *     (hardcoded top-level links, see MainNav.tsx), and the language/currency
 *     pills + cart/account actions.
 *
 * Auth/cart bits stream via <HeaderAuth/> so the shell stays cacheable.
 */
export default async function Header() {
  const [currenciesResult, activeCurrency] = await Promise.all([
    getCurrencies(),
    getActiveCurrency(),
  ]);
  const currencies: Currency[] = currenciesResult.success ? currenciesResult.data : [];

  return (
    <header className="relative z-40">
      {/* 1. Top utility bar */}
      <div className="bg-ink text-canvas/90 py-2.5 text-xs border-b border-stone-taupe/20">
        <div className="container mx-auto px-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 sm:gap-6">
            <div className="flex items-center gap-2.5">
              <a
                href="https://www.facebook.com/tosodouliko"
                target="_blank"
                rel="noreferrer"
                aria-label="Facebook"
                className="text-canvas hover:text-terracotta transition-colors"
              >
                <Facebook className="w-4 h-4" />
              </a>
              <a
                href="https://www.instagram.com/tosodouliko.gr"
                target="_blank"
                rel="noreferrer"
                aria-label="Instagram"
                className="text-canvas hover:text-terracotta transition-colors"
              >
                <Instagram className="w-4 h-4" />
              </a>
              <a
                href="https://www.tiktok.com/@tosodouliko0"
                target="_blank"
                rel="noreferrer"
                aria-label="TikTok"
                className="text-canvas hover:text-terracotta transition-colors"
              >
                <TikTokIcon className="w-4 h-4" />
              </a>
            </div>
            <span className="hidden md:inline text-[11px] font-mono tracking-widest text-stone-taupe lowercase">
              {brand.tagline}
            </span>
          </div>

          <div className="flex items-center gap-3 sm:gap-6 font-mono text-[11px]">
            <div className="hidden sm:block">
              <SearchBar variant="bar" />
            </div>
            <a
              href="https://calendly.com/tosodouliko/30min"
              target="_blank"
              rel="noreferrer"
              className="bg-terracotta hover:bg-canvas hover:text-terracotta text-canvas font-bold px-4 py-2.5 rounded-sm tracking-widest uppercase transition-colors inline-flex items-center gap-1.5 text-xs"
            >
              <Calendar className="w-4 h-4" />
              <span>{strings.layout.nav.appointment}</span>
            </a>
          </div>
        </div>
      </div>

      {/* 2. Sticky main bar */}
      <div className="sticky top-0 z-40 bg-canvas/90 backdrop-blur-md border-b border-stone-taupe/20">
        <div className="container mx-auto px-3 sm:px-4 flex items-center justify-between gap-2 py-2.5 sm:py-3">
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <MobileMenu />
            <Link href="/" aria-label={brand.name} className="group flex items-center">
              <BrandLogo size="sm" />
            </Link>
          </div>

          <div className="hidden xl:flex flex-1 min-w-0 justify-center border-x border-stone-taupe/15 mx-4 px-4">
            <MainNav />
          </div>

          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <div className="hidden md:inline-flex">
              <LanguageSwitcher
                defaultLocale={process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? "el"}
              />
            </div>
            <div className="hidden lg:inline-flex">
              <CurrencySwitcher currencies={currencies} active={activeCurrency} />
            </div>
            <Suspense fallback={<span className="text-stone-taupe text-xs">···</span>}>
              <HeaderAuth />
            </Suspense>
          </div>
        </div>
      </div>
    </header>
  );
}
