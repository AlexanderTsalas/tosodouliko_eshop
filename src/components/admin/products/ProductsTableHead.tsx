"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSelection } from "@/components/admin/common/SelectionContext";
import { usePanelController } from "@/components/admin/products/PanelControllerContext";
import SelectAllHeaderCheckbox from "@/components/admin/common/SelectAllHeaderCheckbox";
import ColumnFilter from "@/components/admin/products/ColumnFilter";
import { bulkDeleteProducts } from "@/actions/products/bulkDeleteProducts";
import { selectAllMatchingHref } from "@/lib/bulk-selection/selectionUrl";
import { Pencil, Trash } from "@/components/admin/common/icons";
import type { AdminProductFilterParams } from "@/lib/admin-products-filter/productFilters";

type Option = { id: string; name: string };

/**
 * Products table header. Two states, swapped in place so selecting rows
 * never shifts the layout (replaces the old separate SelectionActionBar):
 *
 *   - idle:      the column-title row.
 *   - selection: a bulk toolbar (count + "select all N" + Bulk Edit +
 *                Delete + clear) spanning the header, with Select-All
 *                still in its column.
 *
 * Bulk Edit opens the side panel in bulk mode; Delete runs
 * bulkDeleteProducts (double-confirm). matchAll is honoured throughout.
 */
export default function ProductsTableHead({
  pageIds,
  total,
  filterParams,
  categories,
  suppliers,
  volumePrefixes,
}: {
  pageIds: string[];
  total: number;
  filterParams: AdminProductFilterParams;
  categories: Option[];
  suppliers: Option[];
  volumePrefixes: Option[];
}) {
  const { selectedCount, matchAll, selectedIds, clear } = useSelection();
  const { openBulk } = usePanelController();
  const router = useRouter();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const hasSelection = matchAll || selectedCount > 0;
  const effectiveCount = matchAll ? total : selectedCount;
  // Offer "select all N matching" when the whole page is ticked but more
  // rows match the active filters.
  const canExpandToAll =
    !matchAll && selectedCount > 0 && selectedCount >= pageIds.length && total > selectedCount;

  function onBulkEdit() {
    openBulk({
      selectedIds,
      matchAll,
      filterParams: matchAll ? filterParams : undefined,
    });
  }

  function onDelete() {
    const target = matchAll
      ? "όλα τα προϊόντα που ταιριάζουν"
      : `${selectedCount} προϊόντα`;
    if (!confirm(`⚠ Μη αναστρέψιμο: διαγραφή ${target};`)) return;
    if (!confirm(`Επιβεβαιώστε ξανά: διαγραφή ${target}.`)) return;
    startTransition(async () => {
      const r = await bulkDeleteProducts({
        ids: matchAll ? null : selectedIds,
        matchAll,
        filterParams: matchAll ? filterParams : undefined,
      });
      if (r.success) {
        clear();
        router.refresh();
      }
    });
  }

  function expandToAll() {
    startTransition(() =>
      router.push(selectAllMatchingHref(new URLSearchParams(sp.toString())))
    );
  }

  if (hasSelection) {
    return (
      <thead>
        <tr>
          <th className="w-8">
            <SelectAllHeaderCheckbox pageIds={pageIds} />
          </th>
          <th colSpan={10} className="text-left normal-case">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-foreground">
                {effectiveCount.toLocaleString("el-GR")} επιλεγμένα
              </span>
              {canExpandToAll && (
                <button
                  type="button"
                  onClick={expandToAll}
                  className="text-xs text-terracotta hover:underline"
                >
                  Επιλογή και των {total.toLocaleString("el-GR")} που ταιριάζουν
                </button>
              )}
              <button
                type="button"
                onClick={onBulkEdit}
                className="btn btn-secondary btn-sm inline-flex items-center gap-1"
              >
                <Pencil className="w-3.5 h-3.5" />
                Ομαδική επεξεργασία
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={isPending}
                className="inline-flex items-center gap-1 rounded border border-destructive text-destructive hover:bg-destructive hover:text-background transition-colors px-2.5 py-1 text-xs font-medium disabled:opacity-50"
              >
                <Trash className="w-3.5 h-3.5" />
                Διαγραφή
              </button>
              <button
                type="button"
                onClick={clear}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Καθαρισμός
              </button>
            </div>
          </th>
        </tr>
      </thead>
    );
  }

  return (
    <thead>
      <tr>
        <th className="w-8">
          <SelectAllHeaderCheckbox pageIds={pageIds} />
        </th>
        <th className="w-[120px]" aria-label="Εικόνες"></th>
        <th className="text-left">
          <span className="inline-flex items-center">
            Όνομα
            <ColumnFilter def={{ kind: "text", field: "name", label: "Όνομα" }} />
          </span>
        </th>
        <th className="text-left">
          <span className="inline-flex items-center">
            Base SKU
            <ColumnFilter
              def={{ kind: "text", field: "baseSku", label: "Base SKU" }}
            />
          </span>
        </th>
        <th>
          <span className="inline-flex items-center">
            Τιμή
            <ColumnFilter def={{ kind: "numeric", field: "price", label: "Τιμή" }} />
          </span>
        </th>
        <th>Περιθώριο</th>
        <th>Μέσο κόστος</th>
        <th className="text-left">
          <span className="inline-flex items-center">
            Προτιμώμενος
            <ColumnFilter
              def={{
                kind: "dropdown",
                field: "supplierIds",
                label: "Προτιμώμενος προμηθευτής",
                options: suppliers,
              }}
            />
          </span>
        </th>
        <th className="text-left">
          <span className="inline-flex items-center">
            Κατηγορίες
            <ColumnFilter
              def={{
                kind: "dropdown",
                field: "categoryIds",
                label: "Κατηγορίες",
                options: categories,
              }}
            />
          </span>
        </th>
        <th className="text-left">
          <span className="inline-flex items-center">
            Όγκος
            <ColumnFilter
              def={{
                kind: "dropdown",
                field: "volumePrefixIds",
                label: "Όγκος",
                options: volumePrefixes,
              }}
            />
          </span>
        </th>
        <th>Ενέργειες</th>
      </tr>
    </thead>
  );
}
