import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { strings } from "@/config/strings";

/**
 * Closing showroom / contact strip. Static, links to the existing /contact
 * page. No invented address or phone — kept generic until real details are
 * supplied (drop them into the strings config when available).
 */
export default function ContactStrip() {
  return (
    <section className="py-20 bg-transparent">
      <div className="container mx-auto px-4">
        <div className="relative overflow-hidden rounded-sm border border-stone-taupe/20 bg-ink text-canvas px-6 py-14 sm:px-12 text-center">
          <div className="absolute inset-2 border border-canvas/10 pointer-events-none rounded-sm" />
          <div className="relative z-10 max-w-2xl mx-auto space-y-4">
            <span className="text-[10px] tracking-widest font-mono text-stone-taupe uppercase font-bold">
              {strings.home.contact.eyebrow}
            </span>
            <h2 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight">
              {strings.home.contact.title}
            </h2>
            <p className="text-canvas/80 leading-relaxed">{strings.home.contact.text}</p>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 bg-terracotta hover:bg-canvas text-canvas hover:text-ink font-serif text-sm tracking-widest py-3 px-7 rounded-sm uppercase font-medium transition-colors mt-2"
            >
              <span>{strings.home.contact.cta}</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
