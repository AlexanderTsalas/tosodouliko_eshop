"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Two-axis masonry. Children (the product <li> cards) are real grid items in a
 * fine row-grid; each card's row-span is measured from its content height so
 * cards pack vertically, while some cards opt into `sm:col-span-2` (set on the
 * card itself) so widths vary too — a true photo-wall that staggers on both
 * axes. `grid-auto-flow: dense` backfills the gaps left by the wide cards.
 *
 * The grid fades in once the first measure pass runs, so there's no flash of
 * the pre-layout (collapsed-row) state.
 */
const ROW = 8; // px row unit
const GAP = 20; // px — matches gap-5

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export default function MasonryGrid({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  const [ready, setReady] = useState(false);

  useIsoLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    const items = Array.from(grid.children) as HTMLElement[];

    const layout = () => {
      for (const li of items) {
        const content = (li.firstElementChild as HTMLElement | null) ?? li;
        const h = content.getBoundingClientRect().height;
        const span = Math.max(1, Math.ceil((h + GAP) / (ROW + GAP)));
        li.style.gridRowEnd = `span ${span}`;
      }
      setReady(true);
    };

    layout();
    const ro = new ResizeObserver(layout);
    for (const li of items) {
      const content = li.firstElementChild;
      if (content) ro.observe(content);
    }
    window.addEventListener("resize", layout);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", layout);
    };
  }, [children]);

  // Every card is the same width (18rem = 288px) — no width variation. The
  // masonry varies only on the y-axis (measured row-spans). auto-fit fits as
  // many fixed 18rem columns as the row allows and justify-center centres them.
  return (
    <ul
      ref={ref}
      className={`grid gap-5 justify-center [grid-auto-flow:row_dense] [align-items:start] transition-opacity duration-300 ${
        ready ? "opacity-100" : "opacity-0"
      }`}
      style={{
        gridAutoRows: `${ROW}px`,
        gridTemplateColumns: "repeat(auto-fit, 18rem)",
      }}
    >
      {children}
    </ul>
  );
}
