"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { releaseSoftHoldByHolder } from "@/actions/checkout/releaseSoftHoldByHolder";
import { getPendingWaiterCount } from "@/actions/checkout/getPendingWaiterCount";
import {
  getContestedItemsForSession,
  type ContestedItem,
} from "@/actions/checkout/getContestedItemsForSession";
import { continueCheckoutWithoutContestedItems } from "@/actions/checkout/continueCheckoutWithoutContestedItems";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  sessionId: string;
}

/**
 * Contention surface for the holder on /checkout. Two visual states:
 *
 *   1. Forcing modal — when contention transitions from 0 → ≥1 waiters and
 *      the holder hasn't yet acknowledged this episode. Cannot be dismissed
 *      without one of three choices: continue, drop contested items, or
 *      offer turn. This is the "intentional action" requirement.
 *
 *   2. Passive banner — after the holder picks "continue," the modal closes
 *      and a small banner remains as an ongoing reminder of the countdown
 *      with optional offer-turn / drop-contested controls.
 *
 * Plus the brief "Δεν περιμένει κανείς πλέον" green banner when the queue
 * empties while the holder is still on this page.
 */
export default function ContentionBanner({ sessionId }: Props) {
  const router = useRouter();
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  // True after the holder has consciously chosen "continue" for this episode.
  // Resets to false on any 0→≥1 transition so the next contention wave still
  // forces the modal.
  const [acknowledged, setAcknowledged] = useState(false);
  const [allClear, setAllClear] = useState(false);
  const allClearTimeoutRef = useRef<number | null>(null);

  // Modal sub-state.
  const [dropConfirmOpen, setDropConfirmOpen] = useState(false);
  const [offerConfirmOpen, setOfferConfirmOpen] = useState(false);
  const [contestedItems, setContestedItems] = useState<ContestedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const previousCountRef = useRef<number | null>(null);

  async function fetchCount(): Promise<number> {
    const r = await getPendingWaiterCount({ session_id: sessionId });
    if (!r.success) return 0;
    return r.data.count;
  }

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function refetch() {
      const [count, sessionRes] = await Promise.all([
        fetchCount(),
        supabase
          .from("cart_checkout_sessions")
          .select("expires_at, state")
          .eq("id", sessionId)
          .maybeSingle(),
      ]);
      if (cancelled) return;

      const previous = previousCountRef.current;
      previousCountRef.current = count;

      // 0 → ≥1: contention just began. Reset the per-episode acknowledgement
      // so the forcing modal re-opens (or opens for the first time).
      if ((previous === null || previous === 0) && count > 0) {
        setAcknowledged(false);
      }
      // ≥1 → 0: contention just ended. Show the all-clear banner briefly.
      if (previous !== null && previous > 0 && count === 0) {
        setAllClear(true);
        if (allClearTimeoutRef.current !== null) {
          window.clearTimeout(allClearTimeoutRef.current);
        }
        allClearTimeoutRef.current = window.setTimeout(() => {
          setAllClear(false);
          allClearTimeoutRef.current = null;
        }, 4000);
      }

      setPendingCount(count);
      const s = sessionRes.data as { expires_at: string | null; state: string } | null;
      setExpiresAt(s?.expires_at ?? null);
    }
    refetch();

    const channel = supabase
      .channel(`contention-banner-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cart_checkout_sessions",
          filter: `id=eq.${sessionId}`,
        },
        () => refetch()
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
      if (allClearTimeoutRef.current !== null) {
        window.clearTimeout(allClearTimeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Countdown tick.
  useEffect(() => {
    if (!expiresAt) {
      setRemainingMs(null);
      return;
    }
    const expiresMs = new Date(expiresAt).getTime();
    setRemainingMs(Math.max(0, expiresMs - Date.now()));
    const id = window.setInterval(() => {
      setRemainingMs(Math.max(0, expiresMs - Date.now()));
    }, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  // Lazy-load contested items when the modal opens for Option B.
  useEffect(() => {
    if (pendingCount === null || pendingCount === 0 || acknowledged) {
      setContestedItems(null);
      return;
    }
    let cancelled = false;
    getContestedItemsForSession({ session_id: sessionId }).then((r) => {
      if (cancelled) return;
      if (r.success) setContestedItems(r.data.items);
    });
    return () => {
      cancelled = true;
    };
  }, [pendingCount, acknowledged, sessionId]);

  function handleContinue() {
    setAcknowledged(true);
  }

  function handleDropContested() {
    setError(null);
    startTransition(async () => {
      const r = await continueCheckoutWithoutContestedItems({ session_id: sessionId });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setDropConfirmOpen(false);
      setAcknowledged(true);
      if (r.data.remaining === 0) {
        router.replace("/cart?session_released=1");
      } else {
        router.refresh();
      }
    });
  }

  function handleOfferTurn() {
    setError(null);
    startTransition(async () => {
      const r = await releaseSoftHoldByHolder({ session_id: sessionId });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setOfferConfirmOpen(false);
      router.replace("/cart?session_released=1");
    });
  }

  // Countdown string mm:ss when expires_at is set.
  const countdown = (() => {
    if (remainingMs === null) return null;
    const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const mm = Math.floor(totalSeconds / 60);
    const ss = totalSeconds % 60;
    return `${mm}:${ss.toString().padStart(2, "0")}`;
  })();

  // All-clear has highest priority — appears briefly after queue empties.
  if (allClear) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="mb-4 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
      >
        Δεν περιμένει κανείς πλέον για αυτά τα προϊόντα — μπορείτε να
        συνεχίσετε με την ησυχία σας.
      </div>
    );
  }

  if (pendingCount === null || pendingCount === 0) return null;

  // --- Forcing modal (contention started, not yet acknowledged) ---
  if (!acknowledged) {
    return (
      <>
        <Dialog open={true}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {pendingCount === 1
                  ? "1 πελάτης περιμένει αυτά τα προϊόντα"
                  : `${pendingCount} πελάτες περιμένουν αυτά τα προϊόντα`}
              </DialogTitle>
              <DialogDescription>
                Άλλος πελάτης ζήτησε να αγοράσει κάτι που έχετε στο καλάθι.
                Επιλέξτε πώς θέλετε να συνεχίσετε:
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 text-sm">
              <button
                type="button"
                onClick={handleContinue}
                disabled={isPending}
                className="w-full rounded border border-primary bg-primary text-primary-foreground px-4 py-3 text-left disabled:opacity-50"
              >
                <p className="font-medium">Συνέχιση πληρωμής</p>
                <p className="text-xs opacity-90 mt-0.5">
                  {countdown
                    ? `Έχετε ${countdown} για να ολοκληρώσετε την αγορά. Μετά τη λήξη, η σειρά περνά αυτόματα στον επόμενο.`
                    : "Συνεχίστε με τη συνήθη ροή ολοκλήρωσης παραγγελίας."}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setDropConfirmOpen(true)}
                disabled={isPending || contestedItems === null}
                className="w-full rounded border px-4 py-3 text-left hover:bg-muted/40 disabled:opacity-50"
              >
                <p className="font-medium">Συνέχιση χωρίς αυτά τα προϊόντα</p>
                {contestedItems && contestedItems.length > 0 && (
                  <ul className="mt-1 text-xs text-muted-foreground space-y-0.5">
                    {contestedItems.map((it) => (
                      <li key={it.cart_item_id}>
                        — {it.product_name}
                        {it.variant_label ? ` · ${it.variant_label}` : ""} × {it.quantity}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Αυτά αφαιρούνται από το καλάθι και ο επόμενος πελάτης
                  στη σειρά παίρνει προτεραιότητα. Συνεχίζετε με τα υπόλοιπα.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setOfferConfirmOpen(true)}
                disabled={isPending}
                className="w-full rounded border px-4 py-3 text-left hover:bg-muted/40 disabled:opacity-50"
              >
                <p className="font-medium">Παραχώρηση σειράς</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Επιστρέφετε στο καλάθι και η σειρά περνά στον επόμενο
                  πελάτη. Ίσως δεν μπορέσετε να αγοράσετε τα ίδια προϊόντα
                  μετά.
                </p>
              </button>
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </DialogContent>
        </Dialog>

        {/* Confirm dialogs nested */}
        <Dialog open={dropConfirmOpen} onOpenChange={setDropConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Συνέχιση χωρίς τα διεκδικούμενα προϊόντα;</DialogTitle>
              <DialogDescription>
                Θα αφαιρεθούν από το καλάθι σας και ο επόμενος πελάτης
                αναμονής αποκτά προτεραιότητα 5 λεπτών σε αυτά. Δεν μπορείτε
                να αναιρέσετε αυτή την ενέργεια.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <button
                type="button"
                onClick={() => setDropConfirmOpen(false)}
                disabled={isPending}
                className="rounded border px-4 py-2 text-sm"
              >
                Άκυρο
              </button>
              <button
                type="button"
                onClick={handleDropContested}
                disabled={isPending}
                className="rounded bg-destructive text-destructive-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {isPending ? "Αφαίρεση..." : "Ναι, αφαίρεση και συνέχιση"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={offerConfirmOpen} onOpenChange={setOfferConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Παραχώρηση σειράς;</DialogTitle>
              <DialogDescription>
                Όλα τα προϊόντα του καλαθιού σας επιστρέφουν στο διαθέσιμο
                απόθεμα και ο επόμενος πελάτης αναμονής αποκτά προτεραιότητα
                5 λεπτών για να ολοκληρώσει.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Ίσως δεν μπορέσετε να αγοράσετε τα ίδια προϊόντα μετά.
            </p>
            <DialogFooter>
              <button
                type="button"
                onClick={() => setOfferConfirmOpen(false)}
                disabled={isPending}
                className="rounded border px-4 py-2 text-sm"
              >
                Άκυρο
              </button>
              <button
                type="button"
                onClick={handleOfferTurn}
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

  // --- Passive floating widget (acknowledged). Mirrors the waiter-side
  // FloatingPromotionTimer's bottom-right placement so both flows feel
  // consistent. The "Επιλογές" button resets `acknowledged` so the forcing
  // modal re-opens, giving the holder access to all three options again.
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 max-w-xs rounded-lg border border-amber-300 bg-white shadow-lg p-3 text-sm"
    >
      <p className="font-medium text-amber-900">
        {pendingCount === 1
          ? "1 πελάτης περιμένει"
          : `${pendingCount} πελάτες περιμένουν`}
      </p>
      {countdown && (
        <p className="font-mono text-2xl font-semibold text-amber-700 mt-0.5">
          {countdown}
        </p>
      )}
      <p className="text-xs text-muted-foreground mt-1">
        για να ολοκληρώσετε την αγορά
      </p>
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setAcknowledged(false)}
          disabled={isPending}
          className="w-full rounded border px-3 py-1 text-xs hover:bg-muted/40 disabled:opacity-50"
        >
          Επιλογές
        </button>
      </div>
    </div>
  );
}
