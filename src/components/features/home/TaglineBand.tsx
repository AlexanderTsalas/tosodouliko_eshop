import { Sparkles } from "lucide-react";
import { strings } from "@/config/strings";

/**
 * Warm tagline band between the featured and category sections. Static copy
 * from the strings config; subtle dotted texture behind the message.
 */
export default function TaglineBand() {
  return (
    <section className="relative z-10 bg-warm-sand py-14 md:py-16 text-center border-b border-stone-taupe/20 shadow-[0_12px_40px_-12px_rgba(43,36,32,0.3)]">
      <div className="absolute inset-0 opacity-10 pointer-events-none bg-[radial-gradient(#2B2420_1px,transparent_1px)] [background-size:20px_20px]" />
      <div className="max-w-4xl mx-auto px-4 relative z-10 space-y-4">
        <Sparkles className="w-6 h-6 text-terracotta mx-auto mb-1" />
        <h2 className="font-serif text-2xl sm:text-3xl lg:text-4xl font-bold text-ink leading-tight tracking-tight">
          {strings.home.tagline.title}
        </h2>
        <p className="font-sans text-sm md:text-base text-ink/80 leading-relaxed max-w-2xl mx-auto">
          {strings.home.tagline.text}
        </p>
      </div>
    </section>
  );
}
