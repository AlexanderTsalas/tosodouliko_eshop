import Link from "next/link";
import { Facebook, Instagram } from "lucide-react";
import { brand } from "@/config/brand";
import { strings } from "@/config/strings";
import BrandLogo from "@/components/layout/BrandLogo";
import TikTokIcon from "@/components/layout/TikTokIcon";
import NewsletterForm from "@/components/features/newsletter/NewsletterForm";

/**
 * Storefront footer — warm-artisan treatment. The brand lockup + socials sit
 * above the four existing link columns (serif headings), with a hairline
 * divider and copyright strip below. Links/strings are unchanged.
 */
export default function Footer() {
  return (
    <footer className="relative z-10 mt-16 border-t border-stone-taupe/25 bg-warm-sand">
      <div className="container mx-auto px-4 py-12">
        {/* Brand row */}
        <div className="flex flex-col items-center text-center gap-4 pb-10 border-b border-stone-taupe/20">
          <BrandLogo size="md" />
          <div className="flex items-center gap-4">
            <a
              href="https://www.facebook.com/tosodouliko"
              target="_blank"
              rel="noreferrer"
              aria-label="Facebook"
              className="text-stone-taupe hover:text-terracotta transition-colors"
            >
              <Facebook className="w-4 h-4" />
            </a>
            <a
              href="https://www.instagram.com/tosodouliko.gr"
              target="_blank"
              rel="noreferrer"
              aria-label="Instagram"
              className="text-stone-taupe hover:text-terracotta transition-colors"
            >
              <Instagram className="w-4 h-4" />
            </a>
            <a
              href="https://www.tiktok.com/@tosodouliko0"
              target="_blank"
              rel="noreferrer"
              aria-label="TikTok"
              className="text-stone-taupe hover:text-terracotta transition-colors"
            >
              <TikTokIcon className="w-4 h-4" />
            </a>
          </div>
          <address className="not-italic text-sm text-ink/70 space-y-0.5">
            <p>{brand.contact.addressLine}</p>
            <p>
              <a href={`tel:${brand.contact.phoneHref}`} className="hover:text-terracotta transition-colors">
                {brand.contact.phone}
              </a>
              {" · "}
              <a href={`mailto:${brand.contact.email}`} className="hover:text-terracotta transition-colors">
                {brand.contact.email}
              </a>
            </p>
          </address>
        </div>

        {/* Link columns */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 pt-10 text-sm">
          <div>
            <h3 className="font-serif text-base font-semibold text-ink mb-3">
              {strings.layout.footer.info}
            </h3>
            <ul className="space-y-2 text-ink/70">
              <li><Link href="/about" className="hover:text-terracotta transition-colors">{strings.layout.footer.about}</Link></li>
              <li><Link href="/contact" className="hover:text-terracotta transition-colors">{strings.layout.footer.contact}</Link></li>
              <li><Link href="/terms" className="hover:text-terracotta transition-colors">{strings.layout.footer.terms}</Link></li>
              <li><Link href="/privacy" className="hover:text-terracotta transition-colors">{strings.layout.footer.privacy}</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="font-serif text-base font-semibold text-ink mb-3">
              {strings.layout.footer.service}
            </h3>
            <ul className="space-y-2 text-ink/70">
              <li><Link href="/shipping" className="hover:text-terracotta transition-colors">{strings.layout.footer.shipping}</Link></li>
              <li><Link href="/returns" className="hover:text-terracotta transition-colors">{strings.layout.footer.returns}</Link></li>
              <li><Link href="/faq" className="hover:text-terracotta transition-colors">{strings.layout.footer.faq}</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="font-serif text-base font-semibold text-ink mb-3">
              {strings.layout.footer.accountSection}
            </h3>
            <ul className="space-y-2 text-ink/70">
              <li><Link href="/auth/signin" className="hover:text-terracotta transition-colors">{strings.layout.footer.signIn}</Link></li>
              <li><Link href="/auth/signup" className="hover:text-terracotta transition-colors">{strings.layout.footer.signUp}</Link></li>
              <li><Link href="/orders" className="hover:text-terracotta transition-colors">{strings.layout.footer.myOrders}</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="font-serif text-base font-semibold text-ink mb-3">
              {strings.layout.footer.newsletter}
            </h3>
            <p className="text-ink/70">{strings.layout.footer.newsletterDescription}</p>
            <NewsletterForm />
          </div>
        </div>
      </div>

      <div className="border-t border-stone-taupe/20 py-4 text-center text-xs text-stone-taupe flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-3">
        <span>© {new Date().getFullYear()} {brand.copyright}</span>
        <span className="hidden sm:inline text-stone-taupe/50">·</span>
        <span>
          Designed &amp; maintained by{" "}
          <a
            href="https://distarter.com"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-ink/70 hover:text-terracotta transition-colors"
          >
            distarter
          </a>
        </span>
      </div>
    </footer>
  );
}
