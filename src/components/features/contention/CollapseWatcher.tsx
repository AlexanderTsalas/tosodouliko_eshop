"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  listPendingCollapseNotifications,
  type PendingCollapseNotification,
} from "@/actions/contention/listPendingCollapseNotifications";
import { acknowledgeCollapseNotifications } from "@/actions/contention/acknowledgeCollapseNotifications";
import { bulkSubscribeToRestockOnCollapse } from "@/actions/contention/bulkSubscribeToRestockOnCollapse";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Globally-mounted watcher for "the holder finalized the sale" events.
 *
 * Signal source: `collapse_notifications` table. placeOrder.ts inserts one
 * row per (waiter, lost variant) right after calling
 * collapse_soft_wait_queue_for_session. We subscribe to INSERT events on
 * that table over Realtime, and also fetch any unacknowledged rows on
 * mount (so an offline-at-collapse-time customer still sees the modal
 * the next time they open the site).
 *
 * Self-actions (the customer voluntarily leaving the queue, removing
 * their cart item) don't write here — so no state-disambiguation is
 * needed in the client. Presence of a row == items were sold to the holder.
 *
 * Accumulates all lost items into a single modal that lists them and
 * offers three actions:
 *   a) Add all to wishlist (subscribe to restock).
 *   b) Pre-order (placeholder — feature ships separately).
 *   c) Continue shopping — dismiss; the items are already gone from cart.
 */
export default function CollapseWatcher() {
  const router = useRouter();
  const [items, setItems] = useState<PendingCollapseNotification[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [preOrderInfoOpen, setPreOrderInfoOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    function pushIfNew(row: PendingCollapseNotification) {
      setItems((prev) => {
        if (prev.some((r) => r.id === row.id)) return prev;
        // De-dup by variant too — Realtime might overlap with the backfill
        // fetch if a notification lands during page load.
        if (prev.some((r) => r.variant_id === row.variant_id)) return prev;
        return [...prev, row];
      });
      setModalOpen(true);
    }

    async function init() {
      const { data: authData } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!authData.user) return;

      const { data: custRow } = await supabase
        .from("customers")
        .select("id")
        .eq("auth_user_id", authData.user.id)
        .maybeSingle();
      if (cancelled) return;
      const customerId = (custRow as { id: string } | null)?.id ?? null;
      if (!customerId) return;

      // Backfill: surface any rows that landed while the user was offline.
      const pending = await listPendingCollapseNotifications();
      if (cancelled) return;
      if (pending.success && pending.data.length > 0) {
        setItems(pending.data);
        setModalOpen(true);
      }

      // Live subscription: INSERTs while the page is open.
      const channel = supabase
        .channel(`collapse-notifications-${customerId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "collapse_notifications",
            filter: `customer_id=eq.${customerId}`,
          },
          (payload) => {
            const row = payload.new as PendingCollapseNotification | undefined;
            if (!row?.id) return;
            pushIfNew(row);
          }
        )
        .subscribe();

      return () => {
        void supabase.removeChannel(channel);
      };
    }

    let cleanup: (() => void) | void;
    init().then((c) => {
      cleanup = c;
    });

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
  }, []);

  function handleAddToWishlist() {
    if (items.length === 0) return;
    setError(null);
    setSuccessMsg(null);
    startTransition(async () => {
      const r = await bulkSubscribeToRestockOnCollapse({
        items: items.map((it) => ({
          product_id: it.product_id,
          variant_id: it.variant_id,
        })),
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setSuccessMsg(
        r.data.subscribed === 1
          ? "1 προϊόν προστέθηκε στη λίστα επιθυμιών."
          : `${r.data.subscribed} προϊόντα προστέθηκαν στη λίστα επιθυμιών.`
      );
    });
  }

  function handleContinueShopping() {
    const ids = items.map((i) => i.id);
    setModalOpen(false);
    setItems([]);
    setError(null);
    setSuccessMsg(null);
    if (ids.length > 0) {
      void acknowledgeCollapseNotifications({ ids });
    }
    router.refresh();
  }

  if (!modalOpen || items.length === 0) return null;

  return (
    <>
      <Dialog open={modalOpen} onOpenChange={(open) => !open && handleContinueShopping()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Τα προϊόντα πωλήθηκαν</DialogTitle>
            <DialogDescription>
              Ο προηγούμενος πελάτης ολοκλήρωσε την αγορά για τα{" "}
              {items.length === 1 ? "ακόλουθο προϊόν" : "ακόλουθα προϊόντα"}
              . Αφαιρέθηκαν από το καλάθι σας:
            </DialogDescription>
          </DialogHeader>

          <ul className="rounded border bg-muted/30 px-3 py-2 text-sm space-y-1">
            {items.map((it) => (
              <li key={it.variant_id}>
                <Link
                  href={`/products/${it.product_slug}`}
                  className="hover:underline font-medium"
                >
                  {it.product_name}
                </Link>
                {it.variant_label && (
                  <span className="text-muted-foreground text-xs">
                    {" "}· {it.variant_label}
                  </span>
                )}
              </li>
            ))}
          </ul>

          <div className="space-y-2 text-sm">
            <button
              type="button"
              onClick={handleAddToWishlist}
              disabled={isPending || successMsg !== null}
              className="w-full rounded border border-primary bg-primary text-primary-foreground px-4 py-3 text-left disabled:opacity-50"
            >
              <p className="font-medium">
                {successMsg
                  ? "Προστέθηκαν στη λίστα επιθυμιών ✓"
                  : "Προσθήκη στη λίστα επιθυμιών"}
              </p>
              <p className="text-xs opacity-90 mt-0.5">
                Θα ενημερωθείτε με email μόλις επιστρέψουν σε απόθεμα.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setPreOrderInfoOpen(true)}
              disabled={isPending}
              className="w-full rounded border px-4 py-3 text-left hover:bg-muted/40 disabled:opacity-50"
            >
              <p className="font-medium">Αίτηση προ-παραγγελίας</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Τα χρειάζεστε σύντομα; Ζητήστε μας να παραγγείλουμε ειδικά
                για εσάς — θα ελέγξουμε τη διαθεσιμότητα.
              </p>
            </button>

            <button
              type="button"
              onClick={handleContinueShopping}
              disabled={isPending}
              className="w-full rounded border px-4 py-3 text-left hover:bg-muted/40 disabled:opacity-50"
            >
              <p className="font-medium">Συνέχιση αγορών</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Έχουν ήδη αφαιρεθεί από το καλάθι. Συνεχίστε χωρίς αυτά.
              </p>
            </button>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {successMsg && (
            <p className="text-sm text-emerald-700">{successMsg}</p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={preOrderInfoOpen} onOpenChange={setPreOrderInfoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Αίτηση προ-παραγγελίας</DialogTitle>
            <DialogDescription>
              Η ροή προ-παραγγελίας ολοκληρώνεται σύντομα. Στο μεταξύ
              μπορείτε να επικοινωνήσετε μαζί μας ή να προσθέσετε τα
              προϊόντα στη λίστα επιθυμιών για να ενημερωθείτε όταν
              επιστρέψουν σε απόθεμα.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setPreOrderInfoOpen(false)}
              className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm"
            >
              Κατάλαβα
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
