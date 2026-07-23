"use client";

import type { MouseEvent } from "react";

/**
 * iOS-style on/off switch. Used on entity cards (rule / offer / code)
 * as the at-a-glance status indicator AND the click target for
 * flipping the entity's `active` flag.
 *
 * Stops click propagation by default — cards that wrap this toggle
 * commonly have their own click handler (expand-to-editor) that should
 * NOT fire when the user is flipping the toggle.
 */
export default function Toggle({
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
  // Track + thumb dimensions per size. Off translateX is fixed at 2px
  // (top-0.5 → left padding from the track edge). On translateX is
  // (trackWidth − thumbWidth − 2) to leave the same 2px right padding.
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
