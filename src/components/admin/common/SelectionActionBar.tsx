"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import Link from "next/link";
import {
  selectAllMatchingHref,
  clearSelectionHref,
  MAX_BULK_OPERATION,
} from "@/lib/bulk-selection/selectionUrl";

interface Props {
  /** Mode the selection is in. */
  matchAll: boolean;
  /** Number of explicitly selected IDs (0 when matchAll). */
  explicitCount: number;
  /** Total rows matching the current filter (used for the "select all N matching" banner). */
  totalMatchingCount: number;
  /** Number of rows on the current page. */
  pageCount: number;
  /** Children render the actual action buttons (Activate / Deactivate / Bulk edit etc.). */
  children?: React.ReactNode;
}

/**
 * Sticky bar above the table summarising the current selection and exposing
 * bulk actions. Three visual modes:
 *
 *   - Nothing selected → renders nothing.
 *   - Some explicit IDs selected → shows count + "Επεξεργασία επιλεγμένων".
 *     If user has selected the whole page AND more rows match the filter, an
 *     inline link offers to expand to "all N matching".
 *   - matchAll active → shows "Όλα τα N εν λόγω προϊόντα είναι επιλεγμένα"
 *     and a way to clear.
 */
export default function SelectionActionBar({
  matchAll,
  explicitCount,
  totalMatchingCount,
  pageCount,
  children,
}: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  if (!matchAll && explicitCount === 0) return null;

  function clear() {
    const params = new URLSearchParams(sp.toString());
    startTransition(() => router.push(clearSelectionHref(params)));
  }

  function expandToMatchAll() {
    const params = new URLSearchParams(sp.toString());
    startTransition(() => router.push(selectAllMatchingHref(params)));
  }

  const effectiveCount = matchAll ? totalMatchingCount : explicitCount;
  const overCap = effectiveCount > MAX_BULK_OPERATION;
  const filledPage = !matchAll && explicitCount >= pageCount && totalMatchingCount > pageCount;

  return (
    // Global cms-bulk-bar look (border + bg + radius + flex-wrap).
    // The sticky positioning is composed on top so this stays pinned
    // to the top of the list page while scrolling.
    <div className="cms-bulk-bar sticky top-0 z-10">
      <span className="cms-bulk-bar-label">
        {matchAll
          ? `Όλα τα ${totalMatchingCount} προϊόντα που ταιριάζουν είναι επιλεγμένα`
          : `${explicitCount} επιλεγμένα`}
      </span>

      {filledPage && (
        <button
          type="button"
          onClick={expandToMatchAll}
          className="text-foreground hover:text-foreground/80 underline text-sm"
        >
          Επιλογή όλων {totalMatchingCount} που ταιριάζουν →
        </button>
      )}

      {overCap && (
        <span className="text-destructive text-xs">
          ⚠ Υπερβαίνει το όριο {MAX_BULK_OPERATION}. Στενέψτε τα φίλτρα.
        </span>
      )}

      {children}

      <button
        type="button"
        onClick={clear}
        className="cms-bulk-bar-clear"
      >
        Καθαρισμός
      </button>
    </div>
  );
}
