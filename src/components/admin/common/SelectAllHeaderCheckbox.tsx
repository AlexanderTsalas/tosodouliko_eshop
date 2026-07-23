"use client";

import { useSelection } from "@/components/admin/common/SelectionContext";

interface Props {
  /** IDs visible on the current page. */
  pageIds: string[];
  /**
   * Kept for backward compatibility — accepted but ignored. The real state
   * comes from <SelectionProvider> context.
   */
  selectedOnPage?: number;
}

/**
 * Header checkbox that selects/deselects all rows on the CURRENT page.
 * Three visual states:
 *   - Empty   → nothing on page is selected. Click → select all on page.
 *   - Mixed   → some rows selected (indeterminate). Click → select all on page.
 *   - Full    → every row on page selected. Click → clear all selection.
 */
export default function SelectAllHeaderCheckbox({ pageIds }: Props) {
  const { isSelected, selectAllOnPage } = useSelection();

  const selectedCount = pageIds.filter((id) => isSelected(id)).length;
  const allChecked = selectedCount > 0 && selectedCount === pageIds.length;
  const indeterminate = selectedCount > 0 && selectedCount < pageIds.length;

  return (
    <input
      type="checkbox"
      checked={allChecked}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate;
      }}
      onChange={() => selectAllOnPage(pageIds)}
      aria-label="Επιλογή όλων στη σελίδα"
      disabled={pageIds.length === 0}
    />
  );
}
