"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { updateWishlistFlags } from "@/actions/wishlist/updateWishlistFlags";
import { removeWishlistItem } from "@/actions/wishlist/removeWishlistItem";
import type { WishlistItemWithProduct } from "@/types/wishlist";

interface Props {
  item: WishlistItemWithProduct;
}

/**
 * Phase 5 — per-row UI on the /wishlist account page.
 *
 * Shows the product (linked to its detail page with variant param), badges
 * for active notification flags, and per-row controls to toggle the flags
 * or remove the entry entirely. Optimistic local updates with rollback on
 * server error.
 *
 * Restock flag: shown only when the variant is currently unavailable
 * (effective_available === 0). When stock is in, the restock subscription
 * is irrelevant — Phase 6's one-shot semantic already cleared it after the
 * most recent restock fired.
 */
export default function WishlistItemRow({ item }: Props) {
  const [restock, setRestock] = useState(item.notify_on_restock);
  const [sale, setSale] = useState(item.notify_on_sale);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function persist(flagPatch: {
    notify_on_restock?: boolean;
    notify_on_sale?: boolean;
  }) {
    startTransition(async () => {
      const r = await updateWishlistFlags({
        wishlist_item_id: item.id,
        ...flagPatch,
      });
      if (!r.success) {
        setError(r.error);
        // Revert optimistic.
        if (flagPatch.notify_on_restock !== undefined) {
          setRestock(item.notify_on_restock);
        }
        if (flagPatch.notify_on_sale !== undefined) {
          setSale(item.notify_on_sale);
        }
      }
    });
  }

  function handleRemove() {
    setRemoved(true);
    startTransition(async () => {
      const r = await removeWishlistItem({ wishlist_item_id: item.id });
      if (!r.success) {
        setRemoved(false);
        setError(r.error);
      }
    });
  }

  if (removed) return null;

  const productHref = item.variant_id
    ? `/products/${item.product_slug}?variant=${item.variant_id}`
    : `/products/${item.product_slug}`;

  const sourceLabel = item.source
    ? {
        product_page: "Από σελίδα προϊόντος",
        contention_modal: "Από διεκδίκηση αποθέματος",
        sold_out_page: "Από εξαντλημένο προϊόν",
      }[item.source]
    : null;

  return (
    <li className="py-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex-1 min-w-0">
        <Link href={productHref} className="font-serif font-bold text-ink hover:text-terracotta transition-colors">
          {item.product_name}
        </Link>
        {item.variant_label && (
          <p className="text-sm text-muted-foreground">{item.variant_label}</p>
        )}
        <p className="text-sm text-muted-foreground">
          {item.price_label && <span>{item.price_label} · </span>}
          Προστέθηκε στις{" "}
          {new Date(item.created_at).toLocaleDateString("el-GR", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}
          {sourceLabel && <> · {sourceLabel}</>}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {restock && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
              📦 Ειδοποίηση όταν επιστρέψει
            </span>
          )}
          {sale && (
            <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-900">
              🏷️ Ειδοποίηση για προσφορές
            </span>
          )}
          {!restock && !sale && (
            <span className="text-xs text-muted-foreground">
              Αποθηκευμένο (χωρίς ειδοποιήσεις)
            </span>
          )}
        </div>
        {item.last_notified_at && (
          <p className="mt-1 text-xs text-muted-foreground">
            Τελευταία ειδοποίηση:{" "}
            {new Date(item.last_notified_at).toLocaleDateString("el-GR", {
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}{" "}
            ({item.last_notification_kind === "restock" ? "απόθεμα" : "προσφορά"})
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:items-end">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={sale}
            disabled={isPending}
            onChange={(e) => {
              setSale(e.target.checked);
              persist({ notify_on_sale: e.target.checked });
            }}
          />
          <span>Προσφορές</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={restock}
            disabled={isPending}
            onChange={(e) => {
              setRestock(e.target.checked);
              persist({ notify_on_restock: e.target.checked });
            }}
            className="mt-0.5"
          />
          <span>
            Απόθεμα
            {item.effective_available > 0 && (
              <span className="ml-1 text-xs text-muted-foreground">
                (διαθέσιμο τώρα — θα ενημερωθείτε αν εξαντληθεί και επανέλθει)
              </span>
            )}
          </span>
        </label>
        <button
          type="button"
          onClick={handleRemove}
          disabled={isPending}
          className="text-xs text-destructive hover:underline disabled:opacity-50"
        >
          Αφαίρεση
        </button>
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}
