"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkSetActive } from "@/actions/products/bulkSetActive";
import { bulkDeleteProducts } from "@/actions/products/bulkDeleteProducts";
import { usePanelController } from "@/components/admin/products/PanelControllerContext";
import type { AdminProductFilterParams } from "@/lib/admin-products-filter/productFilters";

interface Props {
  /** Active selection state — passed through to actions. */
  matchAll: boolean;
  selectedIds: string[];
  /** Current filter params, re-sent to server actions when matchAll=1 so they can resolve the set. */
  filterParams: AdminProductFilterParams;
}

/**
 * Inline action buttons rendered inside <SelectionActionBar>. Two discrete
 * actions (Activate / Deactivate) + Delete (with strong confirm) + the
 * "Επεξεργασία επιλεγμένων" CTA.
 *
 * Discrete actions execute in place via server action; "Επεξεργασία
 * επιλεγμένων" opens the side panel in bulk-edit mode (via
 * PanelController.openBulk) — the tri-state form now lives there instead
 * of a standalone route.
 */
export default function ProductsBulkActions({
  matchAll,
  selectedIds,
  filterParams,
}: Props) {
  const router = useRouter();
  const { openBulk } = usePanelController();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSetActive(active: boolean) {
    const label = active ? "ενεργό" : "ανενεργό";
    const target = matchAll ? "όλα τα προϊόντα που ταιριάζουν" : `${selectedIds.length} προϊόντα`;
    if (!confirm(`Επιβεβαίωση: ορισμός ${target} ως ${label};`)) return;
    setError(null);
    startTransition(async () => {
      const r = await bulkSetActive({
        ids: matchAll ? null : selectedIds,
        matchAll,
        filterParams: matchAll ? filterParams : undefined,
        active,
      });
      if (!r.success) {
        setError(r.error);
      } else {
        router.refresh();
      }
    });
  }

  function handleDelete() {
    const target = matchAll
      ? "όλα τα προϊόντα που ταιριάζουν"
      : `${selectedIds.length} προϊόντα`;
    if (!confirm(`⚠ Μη αναστρέψιμο: διαγραφή ${target};`)) return;
    if (!confirm(`Επιβεβαιώστε ξανά: διαγραφή ${target}.`)) return;
    setError(null);
    startTransition(async () => {
      const r = await bulkDeleteProducts({
        ids: matchAll ? null : selectedIds,
        matchAll,
        filterParams: matchAll ? filterParams : undefined,
      });
      if (!r.success) {
        setError(r.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() =>
          openBulk({
            selectedIds,
            matchAll,
            filterParams: matchAll ? filterParams : undefined,
          })
        }
        className="rounded bg-primary text-primary-foreground px-3 py-1 text-xs"
      >
        Επεξεργασία επιλεγμένων
      </button>
      <button
        type="button"
        onClick={() => handleSetActive(true)}
        disabled={isPending}
        className="rounded border px-3 py-1 text-xs"
      >
        Ενεργοποίηση
      </button>
      <button
        type="button"
        onClick={() => handleSetActive(false)}
        disabled={isPending}
        className="rounded border px-3 py-1 text-xs"
      >
        Απενεργοποίηση
      </button>
      <button
        type="button"
        onClick={handleDelete}
        disabled={isPending}
        className="rounded border border-destructive text-destructive px-3 py-1 text-xs"
      >
        Διαγραφή
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </>
  );
}
