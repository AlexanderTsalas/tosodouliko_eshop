"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { Heart, ChevronDown } from "lucide-react";
import { toggleWishlist } from "@/actions/wishlist/toggleWishlist";
import { updateWishlistFlags } from "@/actions/wishlist/updateWishlistFlags";
import { redirectToSignupIfNotPermanent } from "@/lib/auth/requirePermanentAccount";

interface Props {
  productId: string;
  variantId?: string;
  /** Server-side hydration: whether this product/variant is already in the
   *  customer's wishlist. Drives the initial chevron-vs-save rendering. */
  initiallyIn?: boolean;
  /** When true, the "Notify me when available" checkbox is shown. */
  isUnavailable?: boolean;
}

/**
 * Phase 5 Pattern A wishlist control.
 *
 * Two states:
 *   - Not saved → single button "♡ Αποθήκευση" → silent save (all flags false).
 *   - Saved    → "♥ Αποθηκευμένο ▾" chevron-expand panel:
 *                 ☐ Ειδοποίηση για προσφορές
 *                 ☐ Ειδοποίηση όταν είναι διαθέσιμο   (only if currently unavailable)
 *                 [ Επιβεβαίωση ]   [ Αφαίρεση ]
 *
 * Save always silent first; the customer expands and configures notification
 * preferences as a second deliberate step. Existing flags are NOT pre-loaded
 * (server roundtrip cost) — checkboxes start unchecked and the customer's
 * current state is reflected only on the `/wishlist` account page.
 */
export default function WishlistButton({
  productId,
  variantId,
  initiallyIn = false,
  isUnavailable = false,
}: Props) {
  const [inList, setInList] = useState(initiallyIn);
  const [wishlistItemId, setWishlistItemId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [notifyOnSale, setNotifyOnSale] = useState(false);
  const [notifyOnRestock, setNotifyOnRestock] = useState(false);
  const [savedConfirmation, setSavedConfirmation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Click-outside to collapse.
  useEffect(() => {
    if (!expanded) return;
    function onDocClick(e: MouseEvent) {
      if (!panelRef.current) return;
      if (!panelRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [expanded]);

  function handleSaveClick() {
    setError(null);
    if (inList) {
      setExpanded((v) => !v);
      return;
    }
    startTransition(async () => {
      // Spec §8.3: wishlist requires a permanent account. Anonymous /
      // unauthenticated visitors are redirected to signup before any DB
      // write happens — the silent save itself is gated.
      const ok = await redirectToSignupIfNotPermanent();
      if (!ok) return;
      const r = await toggleWishlist({ productId, variantId });
      if (!r.success) {
        setError(r.error);
        return;
      }
      if (r.data.added) {
        setInList(true);
        setWishlistItemId(r.data.wishlist_item_id);
        setSavedConfirmation(true);
        window.setTimeout(() => setSavedConfirmation(false), 1500);
      }
    });
  }

  function handleConfirm() {
    if (!wishlistItemId) {
      setExpanded(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await updateWishlistFlags({
        wishlist_item_id: wishlistItemId,
        notify_on_restock: notifyOnRestock,
        notify_on_sale: notifyOnSale,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setExpanded(false);
    });
  }

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      // Reuses toggleWishlist's delete branch (idempotent if already gone).
      const r = await toggleWishlist({ productId, variantId });
      if (!r.success) {
        setError(r.error);
        return;
      }
      if (!r.data.added) {
        setInList(false);
        setWishlistItemId(null);
        setExpanded(false);
        setNotifyOnSale(false);
        setNotifyOnRestock(false);
      }
    });
  }

  return (
    <div className="relative w-full" ref={panelRef}>
      <button
        type="button"
        onClick={handleSaveClick}
        disabled={isPending}
        aria-pressed={inList}
        aria-expanded={inList ? expanded : undefined}
        className="w-full inline-flex items-center justify-center gap-2 border border-stone-taupe/30 rounded-sm py-2.5 text-sm font-medium text-ink hover:border-terracotta hover:text-terracotta transition-colors disabled:opacity-50"
      >
        <Heart className={`w-4 h-4 ${inList ? "fill-terracotta text-terracotta" : ""}`} />
        <span>{inList ? "Αποθηκευμένο" : "Αποθήκευση στη λίστα"}</span>
        {inList && (
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
        )}
      </button>

      {savedConfirmation && !expanded && (
        <span
          role="status"
          className="mt-1 block text-center text-xs text-emerald-700"
        >
          ✓ Αποθηκεύτηκε
        </span>
      )}

      {expanded && inList && (
        <div
          role="dialog"
          className="absolute left-0 z-20 mt-2 w-72 max-w-full rounded-sm border border-stone-taupe/25 bg-card p-3 shadow-lg"
        >
          <p className="text-sm font-medium mb-2">Ειδοποιήσεις για αυτό το είδος</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={notifyOnSale}
              onChange={(e) => setNotifyOnSale(e.target.checked)}
              disabled={isPending}
            />
            <span>Ειδοποιήστε με για προσφορές</span>
          </label>
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={notifyOnRestock}
              onChange={(e) => setNotifyOnRestock(e.target.checked)}
              disabled={isPending}
              className="mt-0.5"
            />
            <span>
              Ειδοποιήστε με όταν είναι{" "}
              {isUnavailable ? "ξανά διαθέσιμο" : "ξανά διαθέσιμο μετά από εξάντληση"}
            </span>
          </label>
          <p className="mt-2 text-xs text-muted-foreground">
            Διαχείριση όλων από τη{" "}
            <a href="/wishlist" className="underline">
              λίστα επιθυμιών
            </a>
            .
          </p>
          {error && (
            <p className="mt-2 text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="mt-3 flex justify-between gap-2">
            <button
              type="button"
              onClick={handleRemove}
              disabled={isPending}
              className="text-xs text-destructive underline disabled:opacity-50"
            >
              Αφαίρεση
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isPending}
              className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              {isPending ? "..." : "Επιβεβαίωση"}
            </button>
          </div>
        </div>
      )}

      {error && !expanded && (
        <p className="text-xs text-destructive mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
