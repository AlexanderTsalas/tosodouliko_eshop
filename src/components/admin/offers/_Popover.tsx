"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Lightweight popover used by the sentence-editor chips. Each chip
 * renders as the popover's trigger; clicking it opens the floating
 * content card below the chip with the relevant editor form.
 *
 * Positioning: absolute, top-full, left-0 by default. Auto-flips
 * to right-aligned if the popover would overflow the viewport.
 *
 * Dismissal: click outside or press ESC.
 */
export default function Popover({
  trigger,
  children,
  width = 340,
}: {
  /** The visual element the user clicks. Receives no extra props —
   *  styling lives on the element itself. */
  trigger: ReactNode;
  /** The popover content. Rendered only when open. */
  children: ReactNode | ((close: () => void) => ReactNode);
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  // Re-measure on open: if the popover would overflow the right edge,
  // flip its horizontal alignment.
  useEffect(() => {
    if (!open || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setAlignRight(rect.left + width > window.innerWidth - 16);
  }, [open, width]);

  // Click-outside + ESC dismissal.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // Use pointerdown so the close fires BEFORE click handlers on
    // other chips — avoids the popover "reopening" with the next
    // chip if the user clicks chip→chip rapidly.
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <span ref={containerRef} className="relative inline-block align-baseline">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((x) => !x);
        }}
        className="appearance-none border-0 bg-transparent p-0 m-0 cursor-pointer text-inherit"
      >
        {trigger}
      </button>
      {open && (
        <div
          className={`absolute top-full ${
            alignRight ? "right-0" : "left-0"
          } z-50 mt-1.5 bg-background border border-border rounded-lg shadow-xl p-3 text-foreground`}
          style={{ width }}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </span>
  );
}
