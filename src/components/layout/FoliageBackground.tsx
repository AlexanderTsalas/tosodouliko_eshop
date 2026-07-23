"use client";

import { useEffect, useRef } from "react";

/**
 * Subtle parallax foliage in the storefront side gutters. Two delicate vine
 * layers per edge drift upward at different rates as the page scrolls, giving
 * a gentle "leaves passing by" depth. Pure CSS transforms driven by one
 * rAF-throttled scroll listener; honours prefers-reduced-motion (static) and
 * only renders on lg+ where the gutters exist.
 *
 * The vine art is the supplied rose-pattern SVGs (left/right), chained
 * vertically into a continuous strip. Each tile is exactly TILE px tall, so
 * each layer is translated by -((scroll * rate) % TILE) → the drift is endless
 * and gap-free on pages of any length. Per-side widths follow each file's own
 * aspect ratio so the patterns are never distorted.
 *
 * The SVGs are solid black silhouettes; rendered straight, overlapping layers
 * read as muddy dark shapes. Instead we use them as a CSS *mask* over a flat
 * brand light-brown fill — so each layer is a soft single-tone silhouette and
 * overlaps just deepen the brown slightly instead of clashing.
 *
 * NOTE: keep the layer `-top-[720px]` offsets in sync with TILE below.
 */
const TILE = 720;

/** Brand light-brown (stone-taupe) the vines are tinted to, in two shades so
 *  one layer per side reads slightly darker than the other (depth cue):
 *  left → back darker / front lighter; right → the opposite. */
const VINE_LIGHT = "#C9B79F";
const VINE_DARK = "#7d6238";

// Intrinsic aspect ratios of the supplied patterns (width / height), used to
// derive each tile's width from the shared TILE height with no distortion.
const PATTERNS = {
  left: { src: "/icons_svgs/rose_pattern_left.svg", width: TILE * (294.99585 / 1374.9569) },
  right: { src: "/icons_svgs/rose_pattern_right.svg", width: TILE * (230.24249 / 1374.1211) },
} as const;

/** A vertically-stacked, translatable strip of one rose pattern for a layer. */
function PatternStrip({
  pattern,
  color,
}: {
  pattern: { src: string; width: number };
  color: string;
}) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="block"
          style={{
            width: `${pattern.width}px`,
            height: `${TILE}px`,
            backgroundColor: color,
            WebkitMaskImage: `url(${pattern.src})`,
            maskImage: `url(${pattern.src})`,
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskSize: "100% 100%",
            maskSize: "100% 100%",
          }}
        />
      ))}
    </div>
  );
}

export default function FoliageBackground() {
  const leftBack = useRef<HTMLDivElement>(null);
  const leftFront = useRef<HTMLDivElement>(null);
  const rightBack = useRef<HTMLDivElement>(null);
  const rightFront = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const layers: Array<{ el: HTMLDivElement | null; rate: number }> = [
      { el: leftBack.current, rate: 0.06 },
      { el: leftFront.current, rate: 0.12 },
      { el: rightBack.current, rate: 0.05 },
      { el: rightFront.current, rate: 0.1 },
    ];

    let raf = 0;
    const update = () => {
      const y = window.scrollY;
      for (const { el, rate } of layers) {
        if (el) el.style.transform = `translateY(${-((y * rate) % TILE)}px)`;
      }
      raf = 0;
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(update);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 -z-10 overflow-hidden pointer-events-none hidden lg:block"
      aria-hidden="true"
    >
      {/* Left gutter — scaled down slightly vs the right so the left vines
          read a touch smaller. Origin top-left keeps them seamless + edge-anchored. */}
      <div className="absolute left-0 top-0 h-full w-[18vw] max-w-[300px] scale-90 origin-top-left">
        <div ref={leftBack} className="absolute left-0 -top-[720px] opacity-70 scale-90 will-change-transform">
          <PatternStrip pattern={PATTERNS.left} color={VINE_DARK} />
        </div>
        <div ref={leftFront} className="absolute left-8 -top-[720px] opacity-60 will-change-transform">
          <PatternStrip pattern={PATTERNS.left} color={VINE_LIGHT} />
        </div>
      </div>

      {/* Right gutter */}
      <div className="absolute right-0 top-0 h-full w-[18vw] max-w-[300px]">
        <div ref={rightBack} className="absolute right-0 -top-[720px] opacity-40 scale-90 will-change-transform">
          <PatternStrip pattern={PATTERNS.right} color={VINE_LIGHT} />
        </div>
        <div ref={rightFront} className="absolute right-8 -top-[720px] opacity-55 will-change-transform">
          <PatternStrip pattern={PATTERNS.right} color={VINE_DARK} />
        </div>
      </div>
    </div>
  );
}
