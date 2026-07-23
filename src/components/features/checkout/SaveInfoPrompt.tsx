"use client";

import Link from "next/link";
import { useIsAnonymous } from "@/hooks/useIsAnonymous";

interface Props {
  /** Order id used as the `next` target so the customer lands on their
   *  order detail page after completing signup + email verification. */
  orderId: string;
}

/**
 * Phase 9E + Phase 10 — non-blocking signup CTA card shown on the
 * checkout-success page for anonymous (guest) customers.
 *
 * Earlier iteration was a modal that collected an email and called
 * `requestAnonEmailUpgrade` — this wrote `customers.email` before any
 * verification (the H1 abuse vector flagged in the auth audit). Replaced
 * with the same Option-B pattern used for the wishlist: a card with a
 * direct link to /auth/signup?next=<order url>. The customer creates a
 * real account (password + Supabase email verification), then lands back
 * on their order. No customers.email write happens until Supabase has
 * verified the address.
 *
 * Non-blocking: the success page renders normally; the card is one
 * scroll-level below the order summary. Customer can ignore it.
 */
export default function SaveInfoPrompt({ orderId }: Props) {
  const isAnon = useIsAnonymous();
  if (isAnon !== true) return null;

  const next = encodeURIComponent(`/orders/${orderId}`);

  return (
    <section className="mt-8 rounded border bg-muted/10 p-4">
      <h2 className="font-medium">Αποθηκεύστε τα στοιχεία σας</h2>
      <p className="text-sm text-muted-foreground mt-1">
        Δημιουργήστε έναν λογαριασμό για να παρακολουθείτε την παραγγελία
        σας και να αποθηκεύσετε τη διεύθυνση για επόμενες αγορές. Χρειάζεται
        μόνο email και κωδικός — θα σας στείλουμε email επιβεβαίωσης.
      </p>
      <div className="mt-3 flex gap-3 text-sm">
        <Link
          href={`/auth/signup?next=${next}`}
          className="rounded bg-primary px-4 py-2 font-medium text-primary-foreground"
        >
          Δημιουργία λογαριασμού
        </Link>
        <Link
          href={`/auth/signin?next=${next}`}
          className="rounded border px-4 py-2"
        >
          Έχω ήδη λογαριασμό
        </Link>
      </div>
    </section>
  );
}
