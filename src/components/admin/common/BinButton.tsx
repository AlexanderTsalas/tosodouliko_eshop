"use client";

import { Trash2 } from "lucide-react";

/**
 * Subtle bin-icon button used on workshop cards (offers, custom
 * fields, etc.) for direct deletion. Stops click propagation so it
 * never triggers card expansion. The confirm prompt lives in the
 * parent handler.
 */
export default function BinButton({
  onClick,
  ariaLabel,
}: {
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
    >
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  );
}
