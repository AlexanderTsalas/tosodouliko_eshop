"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  getActivePromotion,
  type ActivePromotion,
} from "@/actions/contention/getActivePromotion";
import { offerPriorityHoldTurn } from "@/actions/contention/offerPriorityHoldTurn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Globally-mounted watcher for the calling customer's
 * soft_wait_promotion priority_holds. When a hold is granted in their
 * name (the queue advances and their turn arrives), opens an explicit
 * modal with three options:
 *
 *   A) "Πληρωμή τώρα"   — navigate immediately to /checkout.
 *   B) "Συνέχιση εντός 5 λεπτών" — close the modal and show a small
 *      floating timer (FloatingPromotionTimer) on the bottom-right.
 *   C) "Παραχώρηση στον επόμενο" — release the hold and promote the
 *      next FIFO waiter. Hidden when no next waiter exists.
 *
 * Lives in the root layout so it works regardless of which page the
 * waiter happens to be on while waiting.
 */
export default function PromotionWatcher() {
  const router = useRouter();
  const [promotion, setPromotion] = useState<ActivePromotion | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [floatingOpen, setFloatingOpen] = useState(false);
  const [confirmOfferOpen, setConfirmOfferOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const seenHoldIdRef = useRef<string | null>(null);

  // Helper to refetch the active promotion.
  async function refetch() {
    const r = await getActivePromotion();
    if (!r.success) return;
    const next = r.data;
    setPromotion(next);

    if (next) {
      // New hold detected — open the modal, reset floating-timer state.
      if (seenHoldIdRef.current !== next.priority_hold_id) {
        seenHoldIdRef.current = next.priority_hold_id;
        setModalOpen(true);
        setFloatingOpen(false);
      }
    } else {
      // Hold gone (consumed/expired/released) — close everything.
      seenHoldIdRef.current = null;
      setModalOpen(false);
      setFloatingOpen(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    // Set up subscription once we know the customer id (or skip if anon).
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

      refetch();

      const channel = supabase
        .channel(`promotion-watcher-${customerId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "priority_holds",
            filter: `customer_id=eq.${customerId}`,
          },
          () => refetch()
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

  function handleGoToCheckout() {
    setModalOpen(false);
    setFloatingOpen(false);
    // Refresh before navigating: invalidates the Router Cache so the
    // destination /cart render is fresh. Without this, returning to a
    // recently-visited /cart (within the ~30s staleTime window) can
    // serve a stale RSC from before the promotion was committed, leaving
    // the "Ολοκλήρωση παραγγελίας" button disabled.
    router.refresh();
    router.push("/cart");
  }

  function handleContinueLater() {
    setModalOpen(false);
    setFloatingOpen(true);
  }

  function handleOfferNext() {
    if (!promotion) return;
    setError(null);
    startTransition(async () => {
      const r = await offerPriorityHoldTurn({
        priority_hold_id: promotion.priority_hold_id,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setConfirmOfferOpen(false);
      setModalOpen(false);
      setFloatingOpen(false);
    });
  }

  if (!promotion) return null;

  return (
    <>
      {/* Forcing modal */}
      <Dialog open={modalOpen} onOpenChange={(open) => !open && setFloatingOpen(true)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Διαθέσιμο τώρα — η σειρά σας ήρθε</DialogTitle>
            <DialogDescription>
              Ο πελάτης που κρατούσε αυτά τα προϊόντα παραχώρησε ή έληξε η
              σειρά του. Το προϊόν δεσμεύθηκε αποκλειστικά για εσάς για τα
              επόμενα 5 λεπτά. Μετά τη λήξη δεν εγγυώμαστε τη διαθεσιμότητα.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded border bg-muted/30 px-3 py-2 text-sm">
            <p className="font-medium">{promotion.product_name}</p>
            {promotion.variant_label && (
              <p className="text-xs text-muted-foreground">
                {promotion.variant_label}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Ποσότητα: {promotion.quantity}
            </p>
          </div>

          <div className="space-y-2 text-sm">
            <button
              type="button"
              onClick={handleGoToCheckout}
              disabled={isPending}
              className="w-full rounded border border-primary bg-primary text-primary-foreground px-4 py-3 text-left disabled:opacity-50"
            >
              <p className="font-medium">Πληρωμή τώρα</p>
              <p className="text-xs opacity-90 mt-0.5">
                Μεταφέρεστε στο καλάθι για να ολοκληρώσετε αμέσως.
              </p>
            </button>

            <button
              type="button"
              onClick={handleContinueLater}
              disabled={isPending}
              className="w-full rounded border px-4 py-3 text-left hover:bg-muted/40 disabled:opacity-50"
            >
              <p className="font-medium">Συνέχιση εντός 5 λεπτών</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Κλείνει το παράθυρο και θα δείτε μικρό χρονόμετρο κάτω
                δεξιά μέχρι να ολοκληρώσετε.
              </p>
            </button>

            {promotion.has_next_waiter ? (
              <button
                type="button"
                onClick={() => setConfirmOfferOpen(true)}
                disabled={isPending}
                className="w-full rounded border px-4 py-3 text-left hover:bg-muted/40 disabled:opacity-50"
              >
                <p className="font-medium">Παραχώρηση στον επόμενο</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Δεν θα αγοράσετε εσείς — η σειρά περνά στον επόμενο πελάτη
                  στη λίστα αναμονής.
                </p>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={isPending}
                className="w-full rounded border px-4 py-3 text-left hover:bg-muted/40 disabled:opacity-50"
              >
                <p className="font-medium">Κλείσιμο</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Δεν υπάρχει άλλος πελάτης στη λίστα αναμονής. Το χρονόμετρο
                  παραμένει κάτω δεξιά αν θέλετε να αποφασίσετε αργότερα.
                </p>
              </button>
            )}
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* Floating timer when the user chose "later" */}
      {floatingOpen && (
        <FloatingPromotionTimer
          promotion={promotion}
          onGoToCheckout={handleGoToCheckout}
          onOpenModal={() => setModalOpen(true)}
        />
      )}

      {/* Inner confirm dialog for Option C */}
      <Dialog open={confirmOfferOpen} onOpenChange={setConfirmOfferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Παραχώρηση στον επόμενο;</DialogTitle>
            <DialogDescription>
              Η σειρά σας περνά στον επόμενο πελάτη της λίστας αναμονής. Δεν
              μπορείτε να αναιρέσετε αυτή την ενέργεια.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConfirmOfferOpen(false)}
              disabled={isPending}
              className="rounded border px-4 py-2 text-sm"
            >
              Άκυρο
            </button>
            <button
              type="button"
              onClick={handleOfferNext}
              disabled={isPending}
              className="rounded bg-destructive text-destructive-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {isPending ? "Παραχώρηση..." : "Ναι, παραχωρήστε τη σειρά"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Small bottom-right widget shown while a promotion is active and the
 * customer chose to act later. Counts down to expires_at; clicking it
 * either re-opens the choice modal or takes the customer straight to
 * checkout (button is split for clarity).
 */
function FloatingPromotionTimer({
  promotion,
  onGoToCheckout,
  onOpenModal,
}: {
  promotion: ActivePromotion;
  onGoToCheckout: () => void;
  onOpenModal: () => void;
}) {
  const expiresMs = new Date(promotion.expires_at).getTime();
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, expiresMs - Date.now())
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      setRemainingMs(Math.max(0, expiresMs - Date.now()));
    }, 1000);
    return () => window.clearInterval(id);
  }, [expiresMs]);

  if (remainingMs <= 0) return null;

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  const display = `${mm}:${ss.toString().padStart(2, "0")}`;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 max-w-xs rounded-lg border border-emerald-300 bg-white shadow-lg p-3 text-sm"
    >
      <p className="font-medium text-emerald-900">Η σειρά σας — λήγει σε</p>
      <p className="font-mono text-2xl font-semibold text-emerald-700">
        {display}
      </p>
      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
        {promotion.product_name}
        {promotion.variant_label ? ` · ${promotion.variant_label}` : ""}
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onGoToCheckout}
          className="flex-1 rounded bg-primary text-primary-foreground px-3 py-1 text-xs"
        >
          Πληρωμή τώρα
        </button>
        <button
          type="button"
          onClick={onOpenModal}
          className="rounded border px-3 py-1 text-xs"
        >
          Επιλογές
        </button>
      </div>
    </div>
  );
}
