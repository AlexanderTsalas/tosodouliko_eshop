"use client";

import { useEffect, type ReactNode } from "react";

/**
 * Centered overlay modal shell — backdrop click + ESC dismiss + a
 * standard header / body / footer layout. Used by every "+ Νέο…"
 * creation flow on the workshop benches so they all feel the same.
 *
 * Body content sits in a `space-y-3` flow column; the footer is a
 * right-aligned button row separated by a top border.
 */
export default function CenteredModal({
  title,
  subtitle,
  onCancel,
  children,
  footer,
  maxWidth = "max-w-md",
  z = "z-50",
}: {
  title: string;
  subtitle?: ReactNode;
  onCancel: () => void;
  children: ReactNode;
  footer: ReactNode;
  /** Tailwind max-width class (default `max-w-md` for ~28rem). */
  maxWidth?: string;
  /** Tailwind z-index class for the overlay. Default `z-50`; raise it
   *  (e.g. `z-[70]`) when the modal can open over the product side panel
   *  (aside z-60). */
  z?: string;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className={`fixed inset-0 ${z} bg-foreground/40 flex items-center justify-center p-4`}
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`bg-background rounded-lg shadow-2xl ${maxWidth} w-full p-5 space-y-4`}
      >
        <header>
          <h3 className="text-base font-semibold">{title}</h3>
          {subtitle && (
            <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>
          )}
        </header>
        <div className="space-y-3">{children}</div>
        <footer className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          {footer}
        </footer>
      </div>
    </div>
  );
}
