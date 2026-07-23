"use client";

import { useMemo, useState } from "react";
import { ArrowUp, ArrowDown, Plus, Search } from "lucide-react";
import BinButton from "@/components/admin/common/BinButton";
import type { RelatedProductsManualPick } from "@/types/related-products";

interface Props {
  picks: RelatedProductsManualPick[];
  products: Array<{ id: string; name: string }>;
  onAdd: (product_id: string) => void;
  onRemove: (pick_id: string) => void;
  /** Bulk-reorder: parent computes the new full order locally then
   *  calls this with the array of pick ids in the desired sequence.
   *  Server applies sort_order = index. */
  onReorder: (ordered_ids: string[]) => void;
}

/**
 * Manual-picks editor — shown only when `selection_strategy = 'manual'`.
 *
 *   • Ordered list of picked products with up/down arrows + bin
 *   • Add new pick via searchable inline picker over products not yet
 *     in the list
 *
 * Reorder semantics: each click on an arrow swaps adjacent rows
 * locally, then sends the FULL new order to the server. The bench
 * router.refresh()es on success; on failure the parent reverts.
 */
export default function ManualPicksEditor({
  picks,
  products,
  onAdd,
  onRemove,
  onReorder,
}: Props) {
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  const productById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) m.set(p.id, p.name);
    return m;
  }, [products]);

  // Sorted by sort_order for stable display, even if the parent's
  // local state isn't pre-sorted.
  const ordered = useMemo(
    () => [...picks].sort((a, b) => a.sort_order - b.sort_order),
    [picks]
  );

  const candidates = useMemo(() => {
    const picked = new Set(ordered.map((p) => p.product_id));
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (picked.has(p.id)) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q);
    });
  }, [products, ordered, query]);

  function moveUp(index: number) {
    if (index <= 0) return;
    const reordered = [...ordered];
    [reordered[index - 1], reordered[index]] = [
      reordered[index],
      reordered[index - 1],
    ];
    onReorder(reordered.map((p) => p.id));
  }
  function moveDown(index: number) {
    if (index >= ordered.length - 1) return;
    const reordered = [...ordered];
    [reordered[index], reordered[index + 1]] = [
      reordered[index + 1],
      reordered[index],
    ];
    onReorder(reordered.map((p) => p.id));
  }

  return (
    <div className="space-y-3">
      {ordered.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          Καμία χειροκίνητη επιλογή ακόμη. Προσθέστε προϊόντα παρακάτω για
          να ορίσετε ακριβή σειρά.
        </p>
      ) : (
        <ol className="rounded-md border border-border divide-y divide-border bg-background">
          {ordered.map((pick, i) => {
            const name = productById.get(pick.product_id) ?? "(διαγραμμένο)";
            return (
              <li
                key={pick.id}
                className="flex items-center gap-2 px-3 py-2 text-sm"
              >
                <span className="text-xs text-muted-foreground tabular-nums w-6">
                  {i + 1}.
                </span>
                <span className="flex-1 truncate">{name}</span>
                <button
                  type="button"
                  onClick={() => moveUp(i)}
                  disabled={i === 0}
                  aria-label="Πάνω"
                  className="w-7 h-7 inline-flex items-center justify-center rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => moveDown(i)}
                  disabled={i === ordered.length - 1}
                  aria-label="Κάτω"
                  className="w-7 h-7 inline-flex items-center justify-center rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <BinButton
                  onClick={() => onRemove(pick.id)}
                  ariaLabel={`Αφαίρεση ${name}`}
                />
              </li>
            );
          })}
        </ol>
      )}

      {/* Add new pick — searchable picker. Collapsed when not open so
          the editor stays compact. */}
      {pickerOpen ? (
        <div className="rounded-md border border-border bg-background p-2 space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Αναζήτηση προϊόντος…"
              className="cms-input pl-8 text-sm"
              autoFocus
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {candidates.length === 0 ? (
              <p className="text-xs text-muted-foreground italic px-2 py-3">
                {query
                  ? "Κανένα προϊόν δεν ταιριάζει."
                  : "Όλα τα προϊόντα είναι ήδη στη λίστα."}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {candidates.slice(0, 50).map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onAdd(p.id);
                        setQuery("");
                        // Stay open for fast multi-add.
                      }}
                      className="w-full text-left px-2 py-1.5 hover:bg-muted text-sm transition-colors"
                    >
                      {p.name}
                    </button>
                  </li>
                ))}
                {candidates.length > 50 && (
                  <li className="px-2 py-1.5 text-[10px] text-muted-foreground italic">
                    +{candidates.length - 50} ακόμη — περιορίστε την αναζήτηση.
                  </li>
                )}
              </ul>
            )}
          </div>
          <div className="flex justify-end pt-1 border-t border-border">
            <button
              type="button"
              onClick={() => {
                setPickerOpen(false);
                setQuery("");
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Κλείσιμο
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <Plus className="w-3.5 h-3.5" />
          Πρόσθεσε προϊόν
        </button>
      )}
    </div>
  );
}
