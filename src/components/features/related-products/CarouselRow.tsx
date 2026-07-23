"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Horizontal product strip with left/right arrow controls instead of a visible
 * scrollbar. Server-rendered cards are passed as children; only the scroll
 * mechanics are client-side. The arrows scroll by ~80% of the viewport width.
 */
export default function CarouselRow({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);

  const scroll = (dir: number) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <div className="relative">
      <ul
        ref={ref}
        className="no-scrollbar fade-x flex gap-4 overflow-x-auto pb-3 snap-x snap-mandatory scroll-smooth"
      >
        {children}
      </ul>

      <button
        type="button"
        onClick={() => scroll(-1)}
        aria-label="Προηγούμενα"
        className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-10 h-10 rounded-full bg-canvas shadow-md text-[#4a3320] hover:text-terracotta hover:bg-canvas transition-colors"
      >
        <ChevronLeft className="w-6 h-6" />
      </button>
      <button
        type="button"
        onClick={() => scroll(1)}
        aria-label="Επόμενα"
        className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-10 h-10 rounded-full bg-canvas shadow-md text-[#4a3320] hover:text-terracotta hover:bg-canvas transition-colors"
      >
        <ChevronRight className="w-6 h-6" />
      </button>
    </div>
  );
}
