"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { setProductSupplier } from "@/actions/suppliers/setProductSupplier";
import { usePanelController } from "@/components/admin/products/PanelControllerContext";
import { useSelection } from "@/components/admin/common/SelectionContext";
import { useBulkPropagation } from "@/components/admin/products/BulkPropagationContext";

/**
 * Inline-editable supplier cell for the products list table. Mirrors the
 * single-click / double-click pattern from <InlineProductCell/>:
 *
 *   - Single click → navigate to the product side-panel (250ms timer so a
 *     follow-up second click can intercept).
 *   - Double click → open a native <select> with all active suppliers.
 *     Picking one calls setProductSupplier({ productId, supplierId,
 *     isPreferred: true }), which marks that supplier as preferred
 *     across every variant of the product (and demotes the previous
 *     preferred). Native select keeps the UX accessible without
 *     introducing a custom dropdown primitive.
 *   - Blur / Escape → cancels without saving (selecting a value commits).
 */

const NAV_DELAY_MS = 250;

interface SupplierOption {
  id: string;
  name: string;
}

interface Props {
  productId: string;
  /** Current preferred supplier id, if any. */
  currentSupplierId: string | null;
  /** Current preferred supplier display name, used in display mode. */
  currentSupplierName: string | null;
  /** Active suppliers, populating the select options. */
  suppliers: SupplierOption[];
}

export default function InlineSupplierCell({
  productId,
  currentSupplierId,
  currentSupplierName,
  suppliers,
}: Props) {
  const router = useRouter();
  const { open } = usePanelController();
  const { isSelected, selectedIds, selectedCount } = useSelection();
  const { confirmPropagate } = useBulkPropagation();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (editing && selectRef.current) {
      selectRef.current.focus();
    }
  }, [editing]);

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (navTimerRef.current) return;
    navTimerRef.current = setTimeout(() => {
      open(productId);
      navTimerRef.current = null;
    }, NAV_DELAY_MS);
  }

  function handleDoubleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (navTimerRef.current) {
      clearTimeout(navTimerRef.current);
      navTimerRef.current = null;
    }
    setEditing(true);
    setError(null);
  }

  async function handleChange(newSupplierId: string) {
    if (!newSupplierId || newSupplierId === currentSupplierId) {
      setEditing(false);
      return;
    }
    setPending(true);
    setError(null);

    // Bulk inline propagation — set the same preferred supplier on every
    // selected product (explicit multi-selection only). No bulk scalar
    // exists for "preferred supplier" (that's supplier_products.is_preferred,
    // not products.default_supplier_id), so we fan out setProductSupplier.
    if (isSelected(productId) && selectedCount > 1) {
      const applied = await confirmPropagate({
        count: selectedCount,
        message: "τον προτιμώμενο προμηθευτή",
        apply: async () => {
          let firstError: string | undefined;
          for (const pid of selectedIds) {
            const res = await setProductSupplier({
              productId: pid,
              supplierId: newSupplierId,
              isPreferred: true,
            });
            if (!res.success && !firstError) firstError = res.error;
          }
          return { success: !firstError, error: firstError };
        },
      });
      if (applied) {
        setPending(false);
        setEditing(false);
        router.refresh();
        return;
      }
    }

    const r = await setProductSupplier({
      productId,
      supplierId: newSupplierId,
      isPreferred: true,
    });
    setPending(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <select
          ref={selectRef}
          value={currentSupplierId ?? ""}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={() => {
            if (!pending) setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
              setError(null);
            }
          }}
          disabled={pending}
          title={error ?? undefined}
          aria-label="Προτιμώμενος προμηθευτής"
          className={`
            w-44 px-1.5 py-0.5 text-sm rounded-sm
            border ${error ? "border-red-400" : "border-foreground/40"} bg-background
            focus:outline-none focus:border-foreground focus:ring-1 focus:ring-foreground/15
            ${pending ? "opacity-50" : ""}
          `}
        >
          {/* Disabled placeholder when nothing is currently selected. */}
          {!currentSupplierId && (
            <option value="" disabled>
              — Επιλέξτε —
            </option>
          )}
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {pending && (
          <span
            className="inline-block w-2.5 h-2.5 rounded-full border-2 border-foreground/30 border-t-foreground/70 animate-spin"
            aria-hidden
          />
        )}
      </span>
    );
  }

  return (
    <span
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      title="Διπλό κλικ για επεξεργασία"
      className="block truncate text-sm cursor-pointer hover:underline rounded px-0.5 -mx-0.5"
    >
      {currentSupplierName ?? (
        <span className="text-muted-foreground/60">—</span>
      )}
    </span>
  );
}
