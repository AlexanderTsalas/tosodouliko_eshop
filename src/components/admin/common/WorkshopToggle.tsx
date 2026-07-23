"use client";

import type { MouseEvent } from "react";

/**
 * iOS-style on/off switch tuned for the workshop bench layouts (offers,
 * custom fields, etc.). Emerald track when ON; muted when OFF.
 *
 * Differs from `./Toggle.tsx`:
 *   - This one carries the workshop visual identity (emerald active).
 *   - The shared `Toggle.tsx` is monochrome and has optimistic local
 *     state built-in; this one is uncontrolled — the parent owns the
 *     state and re-renders with the new value.
 *
 * Stops click propagation by default so it can sit safely inside a
 * card that has its own click-to-expand handler.
 */
export default function WorkshopToggle({
  active,
  onChange,
  size = "sm",
  ariaLabel,
  disabled = false,
}: {
  active: boolean;
  onChange: (next: boolean) => void;
  size?: "sm" | "md";
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const dims =
    size === "md"
      ? {
          track: "w-11 h-6",
          thumb: "w-5 h-5",
          translateOn: "translate-x-[22px]",
          translateOff: "translate-x-0.5",
        }
      : {
          track: "w-9 h-5",
          thumb: "w-4 h-4",
          translateOn: "translate-x-[18px]",
          translateOff: "translate-x-0.5",
        };

  function handleClick(e: MouseEvent) {
    e.stopPropagation();
    if (disabled) return;
    onChange(!active);
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={handleClick}
      className={`relative inline-flex items-center ${dims.track} shrink-0 rounded-full transition-colors ${
        active ? "bg-emerald-500" : "bg-muted-foreground/30"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
    >
      <span
        aria-hidden
        className={`absolute top-0.5 ${dims.thumb} rounded-full bg-white shadow-sm transition-transform ${
          active ? dims.translateOn : dims.translateOff
        }`}
      />
    </button>
  );
}
