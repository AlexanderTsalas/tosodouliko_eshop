"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { strings } from "@/config/strings";
import SearchBar from "@/components/features/site-search/SearchBar";
import BrandLogo from "@/components/layout/BrandLogo";

/** Hardcoded top-level nav — mirrors MainNav.tsx. No subcategories yet. */
const NAV_LINKS = [
  { label: strings.layout.nav.baptism, href: "/products?category=vaptisi" },
  { label: strings.layout.nav.wedding, href: "/products?category=gamos" },
  { label: strings.layout.nav.clothes, href: "/products?category=rouxa" },
  { label: strings.layout.nav.shoes, href: "/products?category=papoutsia" },
  { label: strings.layout.nav.giftItems, href: "/products?category=doro" },
  { label: strings.layout.nav.giftCards, href: "/products?category=dorokartes" },
];

/**
 * Mobile navigation — a hamburger trigger (xl:hidden) plus a slide-in drawer
 * containing search and the hardcoded primary links. Client component (open
 * state only — no more accordion since the nav is now flat).
 */
export default function MobileMenu() {
  const [open, setOpen] = useState(false);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="xl:hidden p-2 -ml-2 text-ink hover:text-terracotta transition-colors flex items-center justify-center"
        aria-label={strings.categories.menuLabel}
      >
        <Menu className="w-6 h-6" />
      </button>

      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-[60] bg-ink/40 backdrop-blur-sm xl:hidden transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={close}
        aria-hidden="true"
      />

      {/* Drawer panel — full-screen, on the site background colour */}
      <div
        className={`fixed inset-0 z-[70] h-full w-full bg-background xl:hidden transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] flex flex-col ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={strings.categories.menuLabel}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-taupe/20">
          <BrandLogo size="sm" />
          <button
            onClick={close}
            className="p-2 -mr-2 text-ink hover:text-terracotta transition-colors"
            aria-label={strings.categories.closeMenu}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4">
          <SearchBar />
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-6" aria-label={strings.categories.navAriaLabel}>
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={close}
              className="block px-3 py-3 text-sm font-bold uppercase tracking-wider text-ink hover:text-terracotta border-b border-stone-taupe/10 transition-colors"
            >
              {link.label}
            </Link>
          ))}

          <a
            href="https://calendly.com/tosodouliko/30min"
            target="_blank"
            rel="noreferrer"
            onClick={close}
            className="block px-3 py-3 text-sm font-bold uppercase tracking-wider text-ink hover:text-terracotta border-b border-stone-taupe/10 transition-colors"
          >
            {strings.layout.nav.bookAppointment}
          </a>
          <Link
            href="/contact"
            onClick={close}
            className="block px-3 py-3 text-sm font-bold uppercase tracking-wider text-ink hover:text-terracotta border-b border-stone-taupe/10 transition-colors"
          >
            {strings.layout.nav.contact}
          </Link>

          <div className="mt-4 px-3 space-y-3">
            <Link href="/wishlist" onClick={close} className="block text-sm text-ink hover:text-terracotta transition-colors">
              {strings.layout.nav.wishlist}
            </Link>
            <Link href="/cart" onClick={close} className="block text-sm text-ink hover:text-terracotta transition-colors">
              {strings.layout.nav.cart}
            </Link>
            <Link href="/account" onClick={close} className="block text-sm text-ink hover:text-terracotta transition-colors">
              {strings.layout.nav.account}
            </Link>
          </div>
        </nav>
      </div>
    </>
  );
}
