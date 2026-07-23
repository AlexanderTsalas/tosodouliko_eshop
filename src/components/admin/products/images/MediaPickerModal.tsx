"use client";

import { useEffect, useState, useTransition } from "react";
import { X, Search, Loader2, Check, ImageIcon } from "lucide-react";
import { listMediaAssetsForPicker } from "@/actions/media-library/listMediaAssetsForPicker";
import type { MediaAssetForPicker } from "@/types/media-picker";
import { linkMediaAssetsToProduct } from "@/actions/product-images/linkMediaAssetsToProduct";
import type { ProductImage } from "@/types/products";

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Media library picker — full implementation replacing the earlier stub.
 *
 * UX:
 *   - Opens modal, immediately fetches first page of image-only
 *     media_assets (24 per page) via listMediaAssetsForPicker
 *   - Search input: debounced ~250ms, queries filename + alt_text
 *   - Grid: 4 cols on desktop, 3 on tablet, 2 on mobile
 *   - Each tile has a click-to-toggle selection state (checkmark overlay)
 *   - "Load more" button at bottom when hasMore=true
 *   - "Χρήση επιλεγμένων (N)" CTA at the bottom calls
 *     linkMediaAssetsToProduct with the current attribute_combo
 *
 * Performance:
 *   - Search debounce prevents per-keystroke server roundtrips
 *   - Pagination keeps the initial payload small (24 items)
 *   - Selection state lives in this component (cleared on close)
 *
 * The orchestrator passes the active attribute_combo + the productId.
 * On success, the orchestrator gets the new ProductImage[] back via
 * onPicked and merges them into local state (optimistic-replace path).
 */
export default function MediaPickerModal({
  open,
  productId,
  attributeCombo,
  onClose,
  onPicked,
}: {
  open: boolean;
  productId: string;
  attributeCombo: Record<string, string>;
  onClose: () => void;
  onPicked: (rows: ProductImage[]) => void;
}) {
  const [items, setItems] = useState<MediaAssetForPicker[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [linkingPending, startLinkingTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Reset internal state when the modal closes — when it reopens we
  // want a fresh search and no stale selections.
  useEffect(() => {
    if (!open) {
      setItems([]);
      setOffset(0);
      setSearch("");
      setDebouncedSearch("");
      setSelectedIds(new Set());
      setError(null);
    }
  }, [open]);

  // Debounce the search input so we don't fire a server query on
  // every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch the first page when the modal opens or the debounced search
  // term changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setOffset(0);
    listMediaAssetsForPicker({
      pageSize: PAGE_SIZE,
      offset: 0,
      search: debouncedSearch || undefined,
    }).then((r) => {
      if (cancelled) return;
      if (!r.success) {
        setError(r.error);
        setItems([]);
        setTotal(0);
        setHasMore(false);
      } else {
        setItems(r.data.items);
        setTotal(r.data.total);
        setHasMore(r.data.hasMore);
        setOffset(r.data.items.length);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, debouncedSearch]);

  function loadMore() {
    if (loading || !hasMore) return;
    setLoading(true);
    listMediaAssetsForPicker({
      pageSize: PAGE_SIZE,
      offset,
      search: debouncedSearch || undefined,
    }).then((r) => {
      if (!r.success) {
        setError(r.error);
        setLoading(false);
        return;
      }
      setItems((prev) => [...prev, ...r.data.items]);
      setOffset((prev) => prev + r.data.items.length);
      setHasMore(r.data.hasMore);
      setLoading(false);
    });
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleConfirm() {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    startLinkingTransition(async () => {
      const r = await linkMediaAssetsToProduct({
        productId,
        attributeCombo,
        mediaAssetIds: ids,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      onPicked(r.data);
      onClose();
    });
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-background rounded-lg max-w-5xl w-full max-h-[90vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-4 p-5 border-b border-foreground/10">
          <div className="flex-1">
            <h3 className="text-lg font-semibold">Βιβλιοθήκη εικόνων</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Επιλέξτε από εικόνες που έχουν ήδη ανέβει. Οι επιλεγμένες
              θα συνδεθούν με την τρέχουσα ομάδα.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Κλείσιμο"
            className="p-1 text-foreground/60 hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Search bar */}
        <div className="px-5 pt-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Αναζήτηση κατά όνομα αρχείου ή κείμενο alt…"
              className="w-full pl-9 pr-3 py-2 rounded-md border border-foreground/15 bg-background focus:outline-none focus:border-foreground/40 text-sm"
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {items.length === 0 && !loading ? (
            <div className="rounded-md border border-foreground/15 bg-muted/30 p-12 text-center">
              <ImageIcon className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {debouncedSearch
                  ? `Δεν βρέθηκαν εικόνες για «${debouncedSearch}».`
                  : "Δεν υπάρχουν εικόνες στη βιβλιοθήκη ακόμα."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {items.map((asset) => {
                const isSelected = selectedIds.has(asset.id);
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => toggleSelected(asset.id)}
                    aria-pressed={isSelected}
                    className={`relative aspect-square rounded-md border-2 overflow-hidden transition-all ${
                      isSelected
                        ? "border-foreground ring-2 ring-foreground/20"
                        : "border-transparent hover:border-foreground/30"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={asset.url}
                      alt={asset.alt_text ?? asset.filename}
                      className="w-full h-full object-cover"
                      draggable={false}
                    />
                    {isSelected && (
                      <div className="absolute inset-0 bg-foreground/20 flex items-center justify-center">
                        <div className="bg-foreground text-background rounded-full w-9 h-9 flex items-center justify-center shadow-lg">
                          <Check className="w-5 h-5" strokeWidth={3} />
                        </div>
                      </div>
                    )}
                    {/* Filename hint at the bottom */}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5">
                      <p className="text-[10px] text-white/90 truncate">
                        {asset.filename}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Load more */}
          {hasMore && (
            <div className="flex justify-center mt-6">
              <button
                type="button"
                onClick={loadMore}
                disabled={loading}
                className="text-sm px-4 py-2 rounded-md border border-foreground/15 hover:border-foreground/30 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Φόρτωση…
                  </>
                ) : (
                  `Φόρτωση επιπλέον (${items.length} από ${total})`
                )}
              </button>
            </div>
          )}

          {/* Initial-load spinner */}
          {loading && items.length === 0 && (
            <div className="flex justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between gap-4 p-5 border-t border-foreground/10 bg-muted/20">
          <p className="text-sm text-muted-foreground tabular-nums">
            {selectedIds.size > 0
              ? `${selectedIds.size} επιλεγμέν${selectedIds.size === 1 ? "η" : "ες"}`
              : "Καμία επιλογή"}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary btn-sm"
            >
              Άκυρο
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={selectedIds.size === 0 || linkingPending}
              className="btn btn-primary btn-sm flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
            >
              {linkingPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Χρήση επιλεγμένων
              {selectedIds.size > 0 && ` (${selectedIds.size})`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
