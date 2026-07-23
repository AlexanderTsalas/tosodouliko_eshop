"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { subscribeToRestock } from "@/actions/wishlist/subscribeToRestock";
import { joinSoftWaitQueue } from "@/actions/cart/joinSoftWaitQueue";
import { getEffectiveAvailableAction } from "@/actions/inventory/getEffectiveAvailableAction";
import { useEnsureSession } from "@/hooks/useEnsureSession";
import { useVariantInventoryRealtime } from "@/hooks/useVariantInventoryRealtime";
import { redirectToSignupIfNotPermanent } from "@/lib/auth/requirePermanentAccount";

export interface ContestedItem {
  product_id: string;
  variant_id: string;
  product_name: string;
  variant_label: string | null;
  requested_quantity: number;
  available_now: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contested: ContestedItem[];
  /**
   * Where the modal was triggered from. Drives the source field on the
   * resulting wishlist entry so reporting / admin can tell apart cart-failure
   * subscriptions from product-page subscriptions.
   */
  source: "contention_modal" | "sold_out_page";
}

/**
 * Phase 3 + 4 contention modal. Fires when a customer's attempt to engage
 * soft contention (or add to cart with insufficient effective availability)
 * lost the race to another customer.
 *
 * Three options:
 *  - "Add to cart and wait" → Phase 4: joins the soft-wait queue tied to
 *    the currently-holding session. The item enters cart with a "waiting"
 *    badge; Proceed-to-Checkout is disabled until promotion. When the
 *    holder releases, the first-in waiter is promoted to a 5-min priority
 *    hold and can complete checkout.
 *  - "Notify me when available" → subscribes the contested items to
 *    `notify_on_restock`. Phase 6 dispatcher emails when stock returns.
 *  - "Continue without" → just closes; cart is untouched.
 */
export default function ContentionModal({
  open,
  onOpenChange,
  contested,
  source,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"none" | "subscribed" | "queued">(
    "none"
  );
  const ensureSession = useEnsureSession();

  // Phase 10 §16.5: subscribe to inventory_items changes for the contested
  // variants while the modal is open. If the situation resolves
  // underneath (the soft holder paid / abandoned, admin topped up, etc.),
  // show a banner offering retry rather than letting the customer act on
  // stale state.
  const variantIds = useMemo(() => contested.map((c) => c.variant_id), [contested]);
  const [improved, setImproved] = useState(false);
  useVariantInventoryRealtime({
    variantIds: open ? variantIds : [],
    onChange: () => {
      // Cheap refetch: if any contested item is now adequately available,
      // surface the retry banner. Customer must explicitly click — we
      // don't auto-close so we don't surprise mid-thought.
      void (async () => {
        const next = await getEffectiveAvailableAction(variantIds);
        const someResolved = contested.some(
          (c) => (next[c.variant_id] ?? 0) >= c.requested_quantity
        );
        if (someResolved) setImproved(true);
      })();
    },
  });

  async function doSubscribe() {
    for (const item of contested) {
      const r = await subscribeToRestock({
        productId: item.product_id,
        variantId: item.variant_id,
        source,
      });
      if (!r.success) {
        setError(r.error);
        return false;
      }
    }
    setOutcome("subscribed");
    return true;
  }

  function handleSubscribe() {
    setError(null);
    startTransition(async () => {
      // Spec §8.3: wishlist requires a permanent account. Anonymous /
      // unauthenticated visitors are redirected to the signup flow with
      // a `next` param pointing back here, so after the email-verified
      // account creation they land on the same page and can retry.
      const ok = await redirectToSignupIfNotPermanent();
      if (!ok) return; // navigation in progress
      await doSubscribe();
    });
  }

  function handleJoinQueue() {
    setError(null);
    startTransition(async () => {
      // joinSoftWaitQueue works for anon users — they get a soft_wait
      // row tied to their anon customer. No email needed here.
      const userId = await ensureSession();
      if (!userId) {
        setError("Δεν ήταν δυνατή η σύνδεση. Δοκιμάστε ξανά.");
        return;
      }
      for (const item of contested) {
        const r = await joinSoftWaitQueue({
          product_id: item.product_id,
          variant_id: item.variant_id,
          quantity: item.requested_quantity,
        });
        if (!r.success) {
          setError(r.error);
          return;
        }
      }
      setOutcome("queued");
    });
  }

  function handleContinue() {
    setError(null);
    setOutcome("none");
    onOpenChange(false);
  }

  function reset() {
    setOutcome("none");
    setError(null);
    setImproved(false);
    onOpenChange(false);
  }

  const isMultiple = contested.length > 1;
  const firstItem = contested[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {outcome === "subscribed" && (
          <>
            <DialogHeader>
              <DialogTitle>Σας ειδοποιήσαμε ✓</DialogTitle>
              <DialogDescription>
                {isMultiple
                  ? `Προσθέσαμε ${contested.length} προϊόντα στη λίστα επιθυμιών σας. Θα ενημερωθείτε όταν είναι ξανά διαθέσιμα.`
                  : `Προσθέσαμε το «${firstItem?.product_name}» στη λίστα επιθυμιών σας. Θα ενημερωθείτε όταν είναι ξανά διαθέσιμο.`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <button
                type="button"
                onClick={reset}
                className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm"
              >
                Εντάξει
              </button>
            </DialogFooter>
          </>
        )}

        {outcome === "queued" && (
          <>
            <DialogHeader>
              <DialogTitle>Είστε στη λίστα αναμονής ✓</DialogTitle>
              <DialogDescription>
                {isMultiple
                  ? `Προσθέσαμε ${contested.length} προϊόντα στο καλάθι σας με σήμανση «σε αναμονή». Θα μπορέσετε να ολοκληρώσετε την αγορά μόλις ο τρέχων πελάτης απελευθερώσει τα είδη.`
                  : `Προσθέσαμε το «${firstItem?.product_name}» στο καλάθι σας με σήμανση «σε αναμονή». Θα μπορέσετε να ολοκληρώσετε την αγορά μόλις ο τρέχων πελάτης απελευθερώσει το είδος.`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <button
                type="button"
                onClick={reset}
                className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm"
              >
                Εντάξει
              </button>
            </DialogFooter>
          </>
        )}

        {outcome === "none" && (
          <>
            <DialogHeader>
              <DialogTitle>
                {isMultiple
                  ? "Κάποια προϊόντα μόλις εξαντλήθηκαν"
                  : "Το προϊόν μόλις εξαντλήθηκε"}
              </DialogTitle>
              <DialogDescription>
                {isMultiple
                  ? "Άλλος πελάτης βρίσκεται αυτή τη στιγμή σε αγορά για κάποια από τα παρακάτω προϊόντα στο καλάθι σας."
                  : firstItem
                    ? `Άλλος πελάτης βρίσκεται αυτή τη στιγμή σε αγορά για το «${firstItem.product_name}»${
                        firstItem.variant_label ? ` (${firstItem.variant_label})` : ""
                      }.`
                    : "Άλλος πελάτης βρίσκεται αυτή τη στιγμή σε αγορά."}
              </DialogDescription>
            </DialogHeader>

            {contested.length > 1 && (
              <ul className="text-sm space-y-1 border rounded p-3 bg-muted/30">
                {contested.map((it) => (
                  <li key={it.variant_id} className="flex justify-between">
                    <span>
                      {it.product_name}
                      {it.variant_label && (
                        <span className="text-muted-foreground"> · {it.variant_label}</span>
                      )}
                    </span>
                    <span className="text-muted-foreground">
                      ζητήθηκαν {it.requested_quantity} · διαθέσιμα {it.available_now}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {improved && (
              <div
                role="status"
                className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
              >
                Η διαθεσιμότητα άλλαξε. Κλείστε αυτό το παράθυρο και δοκιμάστε
                ξανά να ολοκληρώσετε την παραγγελία.
              </div>
            )}

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              Αν επιλέξετε αναμονή, ο μέγιστος χρόνος μέχρι να μάθετε το
              αποτέλεσμα είναι 20 λεπτά (όσο διαρκεί η συνεδρία του τρέχοντος
              πελάτη).
            </p>

            <DialogFooter className="flex-col gap-2 sm:flex-col sm:gap-2 sm:space-x-0">
              <button
                type="button"
                onClick={handleJoinQueue}
                disabled={isPending}
                className="w-full rounded bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50"
              >
                {isPending ? "Προσθήκη..." : "Προσθήκη στο καλάθι και αναμονή"}
              </button>
              <button
                type="button"
                onClick={handleSubscribe}
                disabled={isPending}
                className="w-full rounded border px-4 py-2 text-sm disabled:opacity-50"
              >
                {isPending ? "Εγγραφή..." : "Ειδοποιήστε με όταν επιστρέψει σε απόθεμα"}
              </button>
              <button
                type="button"
                onClick={handleContinue}
                disabled={isPending}
                className="w-full rounded border-0 px-4 py-2 text-sm text-muted-foreground disabled:opacity-50"
              >
                Συνέχεια χωρίς αυτό
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
