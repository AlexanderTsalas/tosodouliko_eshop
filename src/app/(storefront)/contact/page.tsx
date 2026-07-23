import type { Metadata } from "next";
import { Facebook, Instagram, Calendar, MapPin, Phone, Mail, ExternalLink } from "lucide-react";
import PageHeader from "@/components/layout/PageHeader";
import TikTokIcon from "@/components/layout/TikTokIcon";
import { brand } from "@/config/brand";
import { strings } from "@/config/strings";

export const metadata: Metadata = { title: strings.pages.contact.title };

// Address-based Google Maps embed — works without an API key. The "open in
// maps" link uses the shared place link for the exact pin.
const MAP_EMBED = `https://www.google.com/maps?q=${encodeURIComponent(
  brand.contact.addressLine
)}&output=embed`;
const MAP_LINK = "https://share.google/jKvamVkqAOkRHLDwU";

export default function ContactPage() {
  return (
    <main className="container mx-auto px-4 py-8 max-w-5xl">
      <PageHeader
        title={strings.pages.contact.title}
        description={strings.pages.contact.intro}
        breadcrumb={[{ label: strings.layout.nav.home, href: "/" }, { label: strings.pages.contact.title }]}
      />

      <div className="grid md:grid-cols-2 gap-8 items-stretch">
        {/* Details */}
        <div className="flex flex-col">
          <h2 className="font-serif text-xl font-bold text-ink mb-4">
            {strings.pages.contact.detailsHeading}
          </h2>
          <address className="not-italic space-y-3 text-ink">
            <p className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-terracotta shrink-0 mt-0.5" />
              <span>{brand.contact.addressLine}</span>
            </p>
            <p className="flex items-center gap-3">
              <Phone className="w-5 h-5 text-terracotta shrink-0" />
              <a href={`tel:${brand.contact.phoneHref}`} className="hover:text-terracotta transition-colors">
                {brand.contact.phone}
              </a>
            </p>
            <p className="flex items-center gap-3">
              <Mail className="w-5 h-5 text-terracotta shrink-0" />
              <a href={`mailto:${brand.contact.email}`} className="hover:text-terracotta transition-colors">
                {brand.contact.email}
              </a>
            </p>
          </address>

          <a
            href="https://calendly.com/tosodouliko/30min"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 mt-6 bg-terracotta hover:bg-canvas hover:text-terracotta border border-terracotta text-canvas font-serif text-sm tracking-widest py-3 px-7 rounded-sm uppercase font-medium transition-colors self-start"
          >
            <Calendar className="w-4 h-4" />
            <span>{strings.pages.contact.bookCta}</span>
          </a>

          <div className="mt-auto pt-8">
            <h3 className="font-serif text-base font-bold text-ink mb-3">
              {strings.pages.contact.followUs}
            </h3>
            <div className="flex items-center gap-4">
              <a href="https://www.facebook.com/tosodouliko" target="_blank" rel="noreferrer" aria-label="Facebook" className="text-stone-taupe hover:text-terracotta transition-colors">
                <Facebook className="w-5 h-5" />
              </a>
              <a href="https://www.instagram.com/tosodouliko.gr" target="_blank" rel="noreferrer" aria-label="Instagram" className="text-stone-taupe hover:text-terracotta transition-colors">
                <Instagram className="w-5 h-5" />
              </a>
              <a href="https://www.tiktok.com/@tosodouliko0" target="_blank" rel="noreferrer" aria-label="TikTok" className="text-stone-taupe hover:text-terracotta transition-colors">
                <TikTokIcon className="w-5 h-5" />
              </a>
            </div>
          </div>
        </div>

        {/* Map */}
        <div className="flex flex-col">
          <div className="relative overflow-hidden rounded-sm border border-stone-taupe/25 bg-warm-sand min-h-[320px] flex-1">
            <iframe
              title={`${brand.name} — ${brand.contact.addressLine}`}
              src={MAP_EMBED}
              className="absolute inset-0 w-full h-full"
              style={{ border: 0 }}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          </div>
          <a
            href={MAP_LINK}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 mt-3 text-sm text-terracotta hover:underline self-start"
          >
            <ExternalLink className="w-4 h-4" />
            <span>{strings.pages.contact.viewOnMap}</span>
          </a>
        </div>
      </div>
    </main>
  );
}
