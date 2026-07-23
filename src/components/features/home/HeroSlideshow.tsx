"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ArrowRight } from "lucide-react";
import { strings } from "@/config/strings";

/**
 * Hero slideshow — ported from the reference design with motion → CSS.
 *  - Slides cross-fade via opacity/scale transitions on stacked layers.
 *  - Text reveals with a staggered fade-up (`.hero-rise` + inline delays),
 *    re-triggered on each slide by keying the content wrapper.
 *  - Autoplays every 6s; manual prev/next + indicators.
 * Images live in /public/brand and are easily swappable. Each slide links to
 * the matching category via the existing /products?category=<slug> route.
 */
const SLIDES = [
  { image: "/brand/hero-baptism.png", category: "baptism" },
  { image: "/brand/hero-wedding-church.png", category: "wedding" },
  { image: "/brand/hero-wedding-dance.png", category: "wedding" },
];

export default function HeroSlideshow() {
  const [current, setCurrent] = useState(0);
  const slidesCopy = strings.home.hero.slides;

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrent((p) => (p + 1) % SLIDES.length);
    }, 6500);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="relative h-[78vh] md:h-[82vh] flex items-center overflow-hidden border-b border-stone-taupe/20 bg-warm-sand/20">
      {/* Stacked slide images — long overlapping opacity crossfade with a
          gentle slow zoom on the active frame, for a buttery transition. */}
      <div className="absolute inset-0">
        {SLIDES.map((slide, i) => (
          <div
            key={slide.image}
            className={`absolute inset-0 transition-opacity duration-[1800ms] ease-in-out will-change-[opacity] ${
              i === current ? "opacity-100 z-[1]" : "opacity-0 z-0"
            }`}
          >
            <Image
              src={slide.image}
              alt={slidesCopy[i]?.title ?? ""}
              fill
              priority={i === 0}
              sizes="100vw"
              className={`object-cover transition-transform ease-out will-change-transform ${
                i === current ? "scale-105 duration-[7000ms]" : "scale-100 duration-[1800ms]"
              }`}
            />
          </div>
        ))}
        {/* Warm wash + bottom-up gradient for legibility */}
        <div className="absolute inset-0 bg-ink/20 mix-blend-multiply" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/25 to-transparent opacity-90" />
      </div>

      {/* Content (keyed by slide so the reveal re-runs) */}
      <div className="relative container mx-auto w-full px-4 sm:px-6 z-10 text-left">
        <div key={current} className="flex flex-col items-start max-w-3xl">
          <span
            className="hero-rise inline-block text-[10px] sm:text-xs tracking-[0.2em] font-mono text-canvas uppercase font-semibold bg-terracotta/80 px-3.5 py-1.5 rounded-sm mb-5"
            style={{ animationDelay: "0ms" }}
          >
            {strings.home.hero.badge}
          </span>
          <h1
            className="hero-rise font-serif text-3xl sm:text-5xl lg:text-6xl text-canvas font-bold leading-[1.15] tracking-tight drop-shadow-md mb-6"
            style={{ animationDelay: "120ms" }}
          >
            {slidesCopy[current]?.title}
          </h1>
          <p
            className="hero-rise font-sans text-sm sm:text-base text-canvas/95 max-w-2xl bg-ink/30 backdrop-blur-md p-4 sm:p-5 rounded-sm font-light border border-canvas/10 mb-8 leading-relaxed"
            style={{ animationDelay: "240ms" }}
          >
            {slidesCopy[current]?.subtitle}
          </p>
          <Link
            href={`/products?category=${SLIDES[current].category}`}
            className="hero-rise inline-flex items-center gap-2 bg-canvas hover:bg-terracotta text-ink hover:text-canvas font-serif text-sm tracking-widest py-3 px-7 rounded-sm shadow-md transition-colors duration-300 uppercase font-medium"
            style={{ animationDelay: "360ms" }}
          >
            <span>{strings.home.hero.cta}</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* Prev / next */}
      <button
        onClick={() => setCurrent((p) => (p === 0 ? SLIDES.length - 1 : p - 1))}
        aria-label="Previous"
        className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full border border-stone-taupe/30 bg-canvas/80 backdrop-blur-sm flex items-center justify-center text-ink hover:bg-terracotta hover:text-canvas transition-colors z-20"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <button
        onClick={() => setCurrent((p) => (p + 1) % SLIDES.length)}
        aria-label="Next"
        className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full border border-stone-taupe/30 bg-canvas/80 backdrop-blur-sm flex items-center justify-center text-ink hover:bg-terracotta hover:text-canvas transition-colors z-20"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      {/* Indicators */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex justify-center gap-2 z-20">
        {SLIDES.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            aria-label={`Slide ${i + 1}`}
            className={`h-2 rounded-full transition-all duration-300 ${
              i === current ? "bg-terracotta w-6" : "bg-stone-taupe/50 w-2"
            }`}
          />
        ))}
      </div>
    </section>
  );
}
