"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { updateProduct } from "@/actions/products/updateProduct";
import { bulkUpdateProducts } from "@/actions/products/bulkUpdateProducts";
import { usePanelController } from "@/components/admin/products/PanelControllerContext";
import { useSelection } from "@/components/admin/common/SelectionContext";
import { useBulkPropagation } from "@/components/admin/products/BulkPropagationContext";

/**
 * Inline-editable volumetric-prefix cell. Mirrors <InlineSupplierCell/>
 * — single click navigates the row (250ms timer for dblclick guard);
 * double click opens a native <select> with all active volumetric
 * prefixes; picking one fires updateProduct({ volumetricPrefixId }).
 * Choosing the "—" option clears the override (null).
 */

const NAV_DELAY_MS = 250;

interface VolumetricOption {
  id: string;
  display_name: string;
}

interface Props {
  productId: string;
  currentPrefixId: string | null;
  currentPrefixName: string | null;
  prefixes: VolumetricOption[];
}

export default function InlineVolumetricCell({
  productId,
  currentPrefixId,
  currentPrefixName,
  prefixes,
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

  async function handleChange(raw: string) {
    // Empty string from the placeholder maps to null (clear override).
    const next = raw === "" ? null : raw;
    if (next === currentPrefixId) {
      setEditing(false);
      return;
    }
    setPending(true);
    setError(null);

    // Bulk inline propagation across an explicit multi-selection.
    if (isSelected(productId) && selectedCount > 1) {
      const applied = await confirmPropagate({
        count: selectedCount,
        message: "τον όγκο (volumetric)",
        apply: async () => {
          const res = await bulkUpdateProducts({
            ids: selectedIds,
            matchAll: false,
            filterParams: {},
            scalars: {
              volumetricPrefixId:
                next === null ? { mode: "clear" } : { mode: "set", value: next },
            },
          });
          return {
            success: res.success,
            error: res.success ? undefined : res.error,
          };
        },
      });
      if (applied) {
        setPending(false);
        setEditing(false);
        router.refresh();
        return;
      }
    }

    const r = await updateProduct({
      id: productId,
      volumetricPrefixId: next,
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
          value={currentPrefixId ?? ""}
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
          aria-label="Πρόθεμα όγκου"
          className={`
            w-32 px-1.5 py-0.5 text-sm rounded-sm
            border ${error ? "border-red-400" : "border-foreground/40"} bg-background
            focus:outline-none focus:border-foreground focus:ring-1 focus:ring-foreground/15
            ${pending ? "opacity-50" : ""}
          `}
        >
          <option value="">—</option>
          {prefixes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name}
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
      {currentPrefixName ?? (
        <span className="text-muted-foreground/60">—</span>
      )}
    </span>
  );
}
