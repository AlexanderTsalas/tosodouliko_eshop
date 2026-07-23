"use client";

import {
  createContext,
  useContext,
  useState,
  useTransition,
  useEffect,
  useCallback,
} from "react";
import { useRouter } from "next/navigation";
import { addManyToDraft } from "@/actions/supply-orders/addManyToDraft";
import type { RemovedDraftLine } from "@/actions/supply-orders/removeInventoryVariantsFromDrafts";

const UNDO_WINDOW_MS = 10_000;

interface ToastState {
  lines: RemovedDraftLine[];
  /** Bumped each time a new toast is shown — used to reset the auto-dismiss timer. */
  key: number;
}

interface ContextValue {
  showRemoved: (lines: RemovedDraftLine[]) => void;
}

const Ctx = createContext<ContextValue | null>(null);

/** Used by InventoryRow and InventoryBulkActions to trigger the toast. */
export function useDraftToggleToast(): ContextValue {
  return useContext(Ctx) ?? { showRemoved: () => {} };
}

/**
 * Page-level provider for the "removed from draft" toast with undo. Renders
 * a small notification at the bottom-right when a removal happens; clicking
 * `Αναίρεση` re-creates the deleted lines via addManyToDraft, grouped per
 * supplier so we make one round-trip per supplier rather than per line.
 *
 * Auto-dismisses after UNDO_WINDOW_MS.
 */
export default function DraftToggleToastProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [toast, setToast] = useState<ToastState | null>(null);
  const [isUndoPending, startTransition] = useTransition();

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const showRemoved = useCallback((lines: RemovedDraftLine[]) => {
    if (lines.length === 0) return;
    setToast((cur) => ({ lines, key: (cur?.key ?? 0) + 1 }));
  }, []);

  function handleUndo() {
    if (!toast) return;
    const toRestore = toast.lines;
    setToast(null);
    const bySupplier = new Map<string, Array<{ variantId: string; orderedQty: number }>>();
    for (const l of toRestore) {
      const list = bySupplier.get(l.supplierId) ?? [];
      list.push({ variantId: l.variantId, orderedQty: l.orderedQty });
      bySupplier.set(l.supplierId, list);
    }
    startTransition(async () => {
      for (const [supplierId, items] of bySupplier.entries()) {
        await addManyToDraft({ supplierId, items });
      }
      router.refresh();
    });
  }

  return (
    <Ctx.Provider value={{ showRemoved }}>
      {children}
      {toast && (
        <div
          key={toast.key}
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-md border bg-background shadow-lg px-4 py-2 text-sm"
        >
          <span>
            {toast.lines.length === 1
              ? "Αφαιρέθηκε από draft"
              : `${toast.lines.length} γραμμές αφαιρέθηκαν από drafts`}
          </span>
          <button
            type="button"
            onClick={handleUndo}
            disabled={isUndoPending}
            className="rounded border border-primary text-primary px-3 py-1 text-xs disabled:opacity-50"
          >
            {isUndoPending ? "..." : "Αναίρεση"}
          </button>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Κλείσιμο"
            className="text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </div>
      )}
    </Ctx.Provider>
  );
}
