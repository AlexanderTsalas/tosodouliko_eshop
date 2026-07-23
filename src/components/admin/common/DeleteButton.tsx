"use client";

import { Trash } from "@/components/admin/common/icons";

/**
 * The ONE delete-button rule for the admin.
 *
 * Every destructive "remove this row / item / record" affordance MUST
 * use this component. The rules it encodes:
 *
 *   1. Trash bin icon ALWAYS — same icon component (Lucide-derived)
 *   2. `btn btn-destructive` styling ALWAYS — same hover ring + color
 *   3. Three size variants: sm / md (icon scales with button)
 *   4. Two shape variants:
 *      - default: icon + label ("[bin] Διαγραφή")
 *      - "icon-only": just the icon, with mandatory ariaLabel
 *   5. Disabled prop is FOR PERMANENT DISABLE only (RBAC, etc.).
 *      Do NOT pass `isPending` — the parent should manage that with
 *      a separate disabled state or just let the click trigger
 *      idempotent behavior server-side.
 *
 * If you find yourself writing
 *   <button className="btn btn-destructive ...">
 *     <Trash ... />
 *     Διαγραφή
 *   </button>
 * inline anywhere — STOP, use this component instead. That's the
 * "one rule, no duplication" the codebase wants.
 */

interface Props {
  /** Click handler — usually opens a confirm dialog or calls a delete action. */
  onClick: () => void;
  /**
   * Visible label. When omitted, the button renders as icon-only and
   * `ariaLabel` becomes mandatory for accessibility.
   */
  label?: string;
  /** Accessible label, defaults to the visible label when present. Required for icon-only. */
  ariaLabel?: string;
  /** Optional tooltip — useful for icon-only buttons. */
  title?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  /** Form submit support — rarely needed but kept for parity with native buttons. */
  type?: "button" | "submit";
}

export default function DeleteButton({
  onClick,
  label,
  ariaLabel,
  title,
  size = "sm",
  disabled,
  type = "button",
}: Props) {
  const iconSize = size === "md" ? "w-4 h-4" : "w-3.5 h-3.5";
  const sizeClass = size === "md" ? "btn-md" : "btn-sm";

  // ariaLabel falls back to the label when one is provided; when
  // icon-only, callers MUST pass an explicit ariaLabel (or title).
  const effectiveAria = ariaLabel ?? label;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title ?? effectiveAria}
      aria-label={effectiveAria}
      className={`btn btn-destructive ${sizeClass}`}
    >
      <Trash className={iconSize} />
      {label}
    </button>
  );
}
