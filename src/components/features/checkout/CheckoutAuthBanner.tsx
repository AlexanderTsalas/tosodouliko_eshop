"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { extendForSignupDetour } from "@/actions/checkout/extendForSignupDetour";

interface Props {
  /** Soft session id, used both for the timer-extension RPC and the `next` redirect param. */
  sessionId: string;
}

/**
 * In-checkout banner offering the three auth paths to an anonymous visitor:
 *
 *   - Συνέχιση ως επισκέπτης  → dismiss the banner, continue filling the form
 *   - Σύνδεση                  → extendForSignupDetour, then /auth/signin?next=...
 *   - Δημιουργία λογαριασμού   → extendForSignupDetour, then /auth/signup?next=...
 *
 * The detour extends the contention timer by +5 min (when contention is
 * active) so the round-trip through /auth/* doesn't burn the holder's
 * turn. It's a one-shot per session — the DB function silently no-ops on
 * the second call.
 *
 * Only rendered when the visitor is anonymous; permanent users never see
 * this. Dismissing it just hides the UI; no DB state changes.
 */
export default function CheckoutAuthBanner({ sessionId }: Props) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleGuest() {
    setDismissed(true);
  }

  function handleAuthDetour(target: "signin" | "signup") {
    startTransition(async () => {
      // Best-effort extension — never blocks the navigation.
      await extendForSignupDetour({ session_id: sessionId });
      const nextPath = encodeURIComponent(`/checkout?session=${sessionId}`);
      const base = target === "signin" ? "/auth/signin" : "/auth/signup";
      router.push(`${base}?next=${nextPath}`);
    });
  }

  if (dismissed) return null;

  return (
    <section className="rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-3">
      <div>
        <h2 className="font-semibold text-sm">Έχετε λογαριασμό;</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Με λογαριασμό αποθηκεύετε διευθύνσεις και ιστορικό παραγγελιών. Αν
          υπάρχει σειρά αναμονής για κάποιο προϊόν, η σειρά σας
          παρατείνεται κατά 5 λεπτά για να ολοκληρώσετε την εγγραφή.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
        <button
          type="button"
          onClick={() => handleAuthDetour("signup")}
          disabled={isPending}
          className="rounded border border-primary bg-primary text-primary-foreground px-3 py-2 disabled:opacity-50"
        >
          Δημιουργία λογαριασμού
        </button>
        <button
          type="button"
          onClick={() => handleAuthDetour("signin")}
          disabled={isPending}
          className="rounded border px-3 py-2 hover:bg-muted/40 disabled:opacity-50"
        >
          Έχω ήδη λογαριασμό
        </button>
        <button
          type="button"
          onClick={handleGuest}
          disabled={isPending}
          className="rounded border px-3 py-2 hover:bg-muted/40 disabled:opacity-50"
        >
          Συνέχιση ως επισκέπτης
        </button>
      </div>
    </section>
  );
}
