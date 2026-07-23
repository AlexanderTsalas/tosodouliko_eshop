"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Renders an explanation modal when the cart page is loaded with
 * ?session_expired=1 in the URL — which CheckoutSessionGuard appends when
 * it evicts the customer at wall-clock T-0.
 *
 * Without this, customers would be confused why they suddenly landed back
 * on /cart. With it, they get a clear explanation of what happened and what
 * to do next (review cart, click "Ολοκλήρωση παραγγελίας" again).
 *
 * On dismiss, strips the query param so a back-button refresh doesn't
 * re-open the modal.
 */
export default function SessionExpiredAlert() {
  const params = useSearchParams();
  const router = useRouter();
  const triggered = params.get("session_expired") === "1";
  const [open, setOpen] = useState(triggered);

  // Keep the local state in sync with URL changes within the SPA.
  useEffect(() => {
    if (triggered) setOpen(true);
  }, [triggered]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next && triggered) {
      router.replace("/cart");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Η συνεδρία ολοκλήρωσης παραγγελίας έληξε</DialogTitle>
          <DialogDescription>
            Το παράθυρο των 15 λεπτών για να ολοκληρώσετε την παραγγελία πέρασε
            και τα είδη του καλαθιού σας απελευθερώθηκαν, ώστε να είναι διαθέσιμα
            για άλλους πελάτες.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Μπορείτε να ξεκινήσετε ξανά πατώντας «Ολοκλήρωση παραγγελίας» πιο κάτω.
          Αν κάποιο είδος έχει στο μεταξύ καταχωρηθεί από άλλο πελάτη, θα δείτε
          ξεχωριστή ειδοποίηση.
        </p>
        <DialogFooter>
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Κατάλαβα
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
