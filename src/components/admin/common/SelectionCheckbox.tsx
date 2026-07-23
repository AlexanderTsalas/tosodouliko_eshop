"use client";

import { useSelection } from "@/components/admin/common/SelectionContext";

interface Props {
  id: string;
  /**
   * Kept for backward compatibility — accepted but ignored. The real state
   * comes from <SelectionProvider> context. Callers can leave this off.
   */
  checked?: boolean;
  ariaLabel?: string;
}

/**
 * Per-row checkbox. Reads its checked state from <SelectionProvider>
 * context (optimistic UI — flips instantly on click). The URL push that
 * updates the canonical selection state happens inside the provider in a
 * transition so the rest of the page stays interactive.
 */
export default function SelectionCheckbox({ id, ariaLabel }: Props) {
  const { isSelected, toggle } = useSelection();
  const checked = isSelected(id);

  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={() => toggle(id)}
      aria-label={ariaLabel ? `Select ${ariaLabel}` : "Select row"}
    />
  );
}
