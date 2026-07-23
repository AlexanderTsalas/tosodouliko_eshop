"use client";

import { useEffect, useState } from "react";

interface Props {
  /** Source-of-truth toggle state from the parent (usually server data). */
  checked: boolean;
  /**
   * Click handler. Receives the next state — `!checked`. May be async;
   * the toggle UI flips optimistically BEFORE this fires, so the user
   * sees an instant response even if the underlying mutation takes
   * seconds. If the mutation fails, the parent should update `checked`
   * back to its previous value and the toggle will re-sync.
   */
  onChange: (next: boolean) => void;
  /**
   * Hard-disable the control (greyed-out, no clicks). Use this ONLY for
   * permanent disable conditions (e.g. "this row is preferred and can't
   * be un-preferred"). Do NOT pass `isPending` here — that re-introduces
   * the laggy "wait 3 seconds for the toggle to come back" UX. Async
   * mutations are handled transparently by the optimistic local state.
   */
  disabled?: boolean;
  /** Optional inline label rendered after the switch. */
  label?: React.ReactNode;
  /**
   * Size variant. md (default) is ~40×22; sm is ~32×18 for inline use
   * in dense tables.
   */
  size?: "sm" | "md";
  /** Optional aria-label used when no inline `label` is supplied. */
  ariaLabel?: string;
  /** Optional title attribute (tooltip) — useful for "disabled because…". */
  title?: string;
  /** Optional explicit `type` for the wrapping button. Defaults to "button". */
  type?: "button" | "submit";
}

/**
 * Two-state toggle switch primitive with built-in OPTIMISTIC UI:
 * the visual state flips instantly on click and stays in the new
 * position while the parent runs the async mutation. The `checked`
 * prop is treated as the canonical state; if it changes (e.g. the
 * parent re-fetched and got new data, or reverted on failure) the
 * local state re-syncs.
 *
 * Why we hold local state at all (instead of just rendering `checked`):
 * during the window between the click and the parent's re-render
 * cycle, `checked` still reflects the OLD value. Rendering `checked`
 * directly produces a visual lag — the toggle clicks but doesn't move
 * until the parent's state propagates back. Local state bridges that
 * gap so the click feels instant.
 *
 * Off state: track = `bg-foreground/15`, knob sits at the left
 * On state:  track = `bg-foreground` (inverted), knob slides right
 */
export default function Toggle({
  checked,
  onChange,
  disabled,
  label,
  size = "md",
  ariaLabel,
  title,
  type = "button",
}: Props) {
  // Optimistic local state — drives the rendered toggle position.
  // Initialized from `checked`; flips immediately on click; re-syncs
  // whenever the canonical `checked` prop changes (parent re-render
  // after success / failure revert / external update).
  const [localChecked, setLocalChecked] = useState(checked);
  useEffect(() => {
    setLocalChecked(checked);
  }, [checked]);

  // Tailwind classes — pre-defined so the JIT compiler picks them up.
  const dim =
    size === "sm"
      ? {
          track: "w-8 h-[18px]",
          knob: "w-3 h-3 top-[2px] left-[2px]",
          slide: "translate-x-[14px]",
        }
      : {
          track: "w-10 h-[22px]",
          knob: "w-4 h-4 top-[2px] left-[2px]",
          slide: "translate-x-[18px]",
        };

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (disabled) return;
    const next = !localChecked;
    setLocalChecked(next); // optimistic flip — instant visual response
    onChange(next);
  }

  return (
    <button
      type={type}
      role="switch"
      aria-checked={localChecked}
      aria-label={ariaLabel}
      title={title}
      onClick={handleClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-full`}
    >
      <span
        className={`relative inline-block ${dim.track} rounded-full transition-colors ${
          localChecked
            ? "bg-foreground"
            : "bg-foreground/15 group-hover:bg-foreground/25"
        }`}
        aria-hidden
      >
        <span
          className={`absolute ${dim.knob} rounded-full bg-background shadow-sm transition-transform ${
            localChecked ? dim.slide : ""
          }`}
        />
      </span>
      {label && (
        <span
          className={`text-sm ${
            localChecked ? "font-medium text-foreground" : "text-muted-foreground"
          }`}
        >
          {label}
        </span>
      )}
    </button>
  );
}
