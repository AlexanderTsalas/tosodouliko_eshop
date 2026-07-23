"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { setProductCategories } from "@/actions/products/setProductCategories";
import { bulkUpdateProducts } from "@/actions/products/bulkUpdateProducts";
import { usePanelController } from "@/components/admin/products/PanelControllerContext";
import { useSelection } from "@/components/admin/common/SelectionContext";
import { useBulkPropagation } from "@/components/admin/products/BulkPropagationContext";

/**
 * Inline-editable categories cell. Multi-select via a popover with
 * checkboxes (native <select multiple> is awful UX). Same click/dblclick
 * pattern as the other inline cells:
 *
 *   - Single click → navigate to side panel after a 250ms timer.
 *   - Double click → open popover anchored below the cell with
 *     checkboxes for every active category. Click outside (or Escape)
 *     commits the change set via setProductCategories and closes.
 *
 * The full active catalog comes from page-top fetch; the row's current
 * assignments come from per-row extras.
 */

const NAV_DELAY_MS = 250;

interface CategoryOption {
  id: string;
  name: string;
}

interface Props {
  productId: string;
  currentCategoryIds: string[];
  currentCategoryNames: string[];
  categories: CategoryOption[];
  /** Dynamic (auto-rule) categories the product resolves into. Shown as
   *  read-only chips — they're rule-derived, not manually editable. */
  autoCategoryNames?: string[];
}

export default function InlineCategoriesCell({
  productId,
  currentCategoryIds,
  currentCategoryNames,
  categories,
  autoCategoryNames = [],
}: Props) {
  const router = useRouter();
  const { open } = usePanelController();
  const { isSelected, selectedIds, selectedCount } = useSelection();
  const { confirmPropagate } = useBulkPropagation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(
    new Set(currentCategoryIds)
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fixed-position anchor for the portaled popover (computed on open).
  const [pos, setPos] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });

  // Re-seed draft each time we open the editor — keeps the dialog
  // honest if the underlying assignments were updated server-side
  // between sessions of editing the same row.
  useEffect(() => {
    if (editing) setDraft(new Set(currentCategoryIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // Auto-commit on click outside (or Escape) — same UX as a typical
  // tag picker. Compare draft vs current and bail out if nothing
  // changed to avoid noisy server calls.
  useEffect(() => {
    if (!editing) return;
    function onDocClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        void commit();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draft]);

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
    // Anchor the portaled popover just below the cell.
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left });
    setEditing(true);
    setError(null);
  }

  function toggle(id: string) {
    setDraft((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function cancel() {
    setDraft(new Set(currentCategoryIds));
    setEditing(false);
    setError(null);
  }

  async function commit() {
    // Same set? Just close.
    const currentSet = new Set(currentCategoryIds);
    if (
      draft.size === currentSet.size &&
      [...draft].every((id) => currentSet.has(id))
    ) {
      setEditing(false);
      return;
    }
    setPending(true);
    setError(null);

    // Bulk inline propagation — replaces categories across the explicit
    // selection (matches the single-cell "set categories" semantics).
    if (isSelected(productId) && selectedCount > 1) {
      const ids = Array.from(draft);
      const applied = await confirmPropagate({
        count: selectedCount,
        message: "τις κατηγορίες",
        apply: async () => {
          const res = await bulkUpdateProducts({
            ids: selectedIds,
            matchAll: false,
            filterParams: {},
            categoryOp: { op: "replace", categoryIds: ids },
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

    const r = await setProductCategories({
      productId,
      categoryIds: Array.from(draft),
    });
    setPending(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  const popover =
    editing && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={popoverRef}
            style={{ position: "fixed", top: pos.top, left: pos.left }}
            className="
            z-[60]
            w-64 max-h-64 overflow-y-auto
            rounded-md border border-foreground/20 bg-card
            shadow-[0_8px_24px_-8px_rgba(0,0,0,0.15)]
            p-1.5
          "
            role="listbox"
            aria-multiselectable="true"
          >
          {categories.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic p-2">
              Δεν υπάρχουν διαθέσιμες κατηγορίες.
            </p>
          ) : (
            categories.map((c) => {
              const checked = draft.has(c.id);
              return (
                <label
                  key={c.id}
                  className={`
                    flex items-center gap-2 px-2 py-1 rounded cursor-pointer
                    text-sm
                    ${
                      checked
                        ? "bg-foreground/5 hover:bg-foreground/10"
                        : "hover:bg-foreground/5"
                    }
                  `}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(c.id)}
                    disabled={pending}
                    className="shrink-0"
                  />
                  <span className="truncate">{c.name}</span>
                </label>
              );
            })
          )}
          {pending && (
            <div className="px-2 py-1 text-[10px] text-muted-foreground inline-flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full border-2 border-foreground/30 border-t-foreground/70 animate-spin"
                aria-hidden
              />
              Αποθήκευση…
            </div>
          )}
          {error && (
            <p className="text-[11px] text-destructive px-2 py-1">{error}</p>
          )}
          <div className="text-[10px] text-muted-foreground/70 px-2 py-1 italic border-t border-foreground/10 mt-1">
            Κλικ έξω για αποθήκευση · Escape για ακύρωση
          </div>
        </div>,
          document.body
        )
      : null;

  return (
    <div ref={wrapRef} className="inline-block w-full">
      <span
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        title="Διπλό κλικ για επεξεργασία"
        className="block truncate text-sm cursor-pointer hover:underline rounded px-0.5 -mx-0.5 text-foreground/80"
      >
        {currentCategoryNames.length > 0 ? (
          currentCategoryNames.join(" · ")
        ) : autoCategoryNames.length === 0 ? (
          <span className="text-muted-foreground/60">—</span>
        ) : null}
      </span>
      {/* Dynamic (auto-rule) categories the product resolves into — read-only. */}
      {autoCategoryNames.length > 0 && (
        <div className="mt-0.5 flex flex-wrap gap-1">
          {autoCategoryNames.map((n, i) => (
            <span
              key={i}
              title="Δυναμική κατηγορία — ανατίθεται αυτόματα από κανόνες"
              className="inline-flex items-center gap-1 rounded-sm bg-foreground/[0.06] text-foreground/60 text-[10px] px-1.5 py-0.5"
            >
              <span className="uppercase tracking-wide text-[8px] opacity-70">
                auto
              </span>
              {n}
            </span>
          ))}
        </div>
      )}
      {popover}
    </div>
  );
}
